import json
import re
import time
from datetime import UTC, datetime
from urllib.parse import parse_qsl, urlsplit
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from . import request_log
from .config import Settings
from .db import SCHEMA_VERSION, Database, Guard, WebSession, WriteNeeded, get
from .mail import BrevoMail, FakeMail
from .security import Problem, extension_origin_allowed
from .service import ADMIN_SESSION_SECONDS, OPERATOR_SESSION_SECONDS, WEB_SESSION_SECONDS, Service


def error(code, status=400, retryable=False, correlation_id=None, retry_after=None):
    """
    The error answer. retry_after (whole seconds) is when a refused limit lets the same request
    through again; it goes in the Retry-After header and the body, so a page can say when.
    """
    messages = {
        "otp_rate_limited": "Too many email codes were requested in a short time. Wait, then request a new code.",
        "rate_limited": "Too many requests in a short time. Wait a few minutes and try again.",
        "configuration_required": "This service needs configuration before it can continue.",
        "authentication_required": "Sign in again to continue.",
        "otp_invalid_or_expired": "The code is invalid or expired. Request a new code if needed.",
        "last_admin": "Keep at least one active administrator.",
        "email_service_unavailable": "Email could not be sent. Try again later.",
        "invalid_domain": "Enter the work email domain without @, for example example.com.",
        "domain_review_required": "Your work email must use the organization's work email domain. Free email providers cannot register an organization.",
        "organization_review_required": "An organization with this work email domain is already registered or being registered. Contact us if your organization needs a second one.",
        "organization_not_found": "No organization uses this work email domain. Check that you used your work email, ask your administrator which work email the organization was registered with, or register your organization at aifootprinttracker.com.",
        "admin_required": "Only administrators sign in on the website. Members connect from the AI Footprint Tracker browser extension.",
        "work_email_required": "Use your work email. Free email providers cannot belong to an organization.",
        "capacity_reached": "Your organization has reached its member limit. Ask your administrator.",
        "member_unavailable": "This work email can no longer connect to the organization. Ask your administrator.",
        "service_suspended": "Your organization's use of the service is paused or scheduled for deletion. Ask your administrator.",
        "self_action": "You cannot suspend yourself. Ask another administrator.",
        "confirmation_mismatch": "Type the organization's name exactly as shown to confirm.",
        "organization_deletion_scheduled": "The organization's administrators scheduled it for deletion. Only they can cancel it.",
    }
    # The reference shown with an error is the request's id in the request log.
    entry = request_log.CURRENT.get()
    if entry is not None:
        entry["code"] = code
    return JSONResponse(
        {
            "error": {
                "code": code,
                "retryable": retryable,
                "correlation_id": correlation_id or (entry["id"] if entry else str(uuid4())),
                "safe_message": messages.get(
                    code, "The request could not be completed. Review the current status and try again."
                ),
                **({"retry_after_seconds": retry_after} if status == 429 and retry_after else {}),
            }
        },
        status_code=status,
        headers={
            "Cache-Control": "no-store",
            **({"Retry-After": str(retry_after or 60)} if status == 429 else {}),
        },
    )


def strict_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Problem("duplicate_field", 422)
        result[key] = value
    return result


def depth(value):
    if isinstance(value, dict):
        return 1 + max((depth(child) for child in value.values()), default=0)
    if isinstance(value, list):
        return 1 + max((depth(child) for child in value), default=0)
    return 0


def create_app(settings=None, initialize=False, mail=None, clock=None):
    settings = settings or Settings.from_environment()
    settings.validate()
    database = Database(settings, initialize=initialize)
    delivery = mail or (FakeMail() if settings.mail_adapter == "fake" else BrevoMail(settings))
    if isinstance(delivery, FakeMail) and settings.environment == "production":
        raise ValueError("configuration_required: fake mail prohibited")
    service = Service(settings, database, delivery, clock)
    from .analytics import Analytics

    service.analytics = Analytics(service)
    app = FastAPI(title="AI Footprint Tracker", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.service, app.state.db, app.state.mail = service, database, delivery
    request_log.configure()

    @app.middleware("http")
    async def safe_boundary(request, call_next):
        started = time.perf_counter()
        entry = {"id": str(uuid4()), "code": None}
        request_log.CURRENT.set(entry)
        try:
            response = await call_next(request)
        except Problem as exc:
            response = error(exc.code, exc.status, exc.retryable, retry_after=exc.retry_after)
        except (ValidationError, json.JSONDecodeError, UnicodeDecodeError):
            response = error("invalid_payload", 422)
        except Exception as exception:
            from .diagnostics import record

            correlation_id = entry["id"]
            await run_in_threadpool(record, service, correlation_id, request.url.path, exception)
            entry.update(request_log.failure(exception))
            response = error("internal_error", 500, True, correlation_id)
        response.headers["Cache-Control"] = (
            "no-store, no-transform"
            if response.headers.get("content-type", "").startswith("text/csv")
            else "no-store"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        # A response may name its own policy (the bootstrap form below); every other one sends none.
        if "referrer-policy" not in response.headers:
            response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = response.headers.get(
            "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
        )
        origin = request.headers.get("origin")
        exact_origin = str(request.base_url).rstrip("/")
        if origin == exact_origin or extension_origin_allowed(origin, settings.extension_origins):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            if origin == exact_origin:
                response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["X-Request-ID"] = entry["id"]
        request_log.write(
            {
                **{key: value for key, value in entry.items() if value is not None},
                "at": datetime.now(UTC).isoformat(timespec="milliseconds"),
                "method": request.method,
                "host": (request.headers.get("host") or "")[:100],
                "path": request.url.path[:300],
                "status": response.status_code,
                "ms": round((time.perf_counter() - started) * 1000, 1),
                "origin": request_log.origin_kind(origin, exact_origin),
            }
        )
        return response

    @app.api_route("/{route:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
    async def dispatch(request: Request, route: str):
        path = "/" + route
        if request.method == "OPTIONS":
            origin = request.headers.get("origin")
            if origin != str(request.base_url).rstrip("/") and not extension_origin_allowed(
                origin, settings.extension_origins
            ):
                raise Problem("origin_mismatch", 403)
            return JSONResponse(
                {},
                headers={
                    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
                    "Access-Control-Allow-Headers": "Authorization,Content-Type,X-CSRF-Token",
                    "Access-Control-Max-Age": "600",
                },
            )
        if path == "/health/live":
            return {"status": "live"}
        if path == "/health/ready":
            try:
                with database.transaction(readonly=True) as session:
                    guard = session.get(Guard, 1)
                    if not guard or guard.schema_version != SCHEMA_VERSION:
                        raise ValueError
                    if settings.environment == "production":
                        from datetime import timedelta

                        from .security import parse_time

                        heartbeat = get(session, "maintenance_cursor", "worker-heartbeat")
                        if not heartbeat or parse_time(
                            heartbeat.data["last_tick"]
                        ) < service.now() - timedelta(seconds=settings.worker_max_age_seconds):
                            return error("worker_not_ready", 503, True)
            except Exception:
                return error("database_not_ready", 503, True)
            return {"status": "ready", "schema_version": SCHEMA_VERSION}
        if path == "/health/tls-ask":
            # A front proxy with on-demand certificates asks here before it requests one. Only hosts
            # this service answers for get a certificate, so made-up subdomains cannot use up the
            # certificate authority's rate limit. Organizations have no addresses of their own any
            # more, so only the fixed hosts qualify and no company list is consulted.
            domain = request.query_params.get("domain", "").strip().lower().rstrip(".")
            served = {
                urlsplit(origin).hostname
                for origin in (settings.registration_origin, settings.operator_origin, settings.self_host_origin)
                if origin
            }
            if domain in served:
                return {"status": "allowed"}
            return error("unknown_host", 404)
        if request.url.scheme != "https":
            raise Problem("https_required", 403)
        if request.headers.get("x-forwarded-host"):
            raise Problem("untrusted_host", 403)
        cookies = {}
        protected = {
            "__Host-aift",
            "__Host-aift-operator",
            "__Host-aift-registration",
            "__Host-aift-bootstrap",
        }
        for cookie_header in request.headers.getlist("cookie"):
            for part in cookie_header.split(";"):
                if "=" not in part:
                    continue
                name, value = part.strip().split("=", 1)
                if name in protected and name in cookies:
                    raise Problem("ambiguous_cookie", 403)
                cookies[name] = value
        if len(request.headers.getlist("authorization")) > 1:
            raise Problem("ambiguous_authorization", 403)
        authorization = request.headers.get("authorization", "")
        if authorization and not re.fullmatch(r"Bearer [A-Za-z0-9_-]{32,128}", authorization):
            raise Problem("authentication_required", 401)
        body = {}
        if request.method in {"POST", "PUT", "DELETE"}:
            maximum = 4096 if path == "/v1/auth/bootstrap/exchange" else 524288
            raw = bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw) > maximum:
                    raise Problem("payload_too_large", 413)
            content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            if path == "/v1/auth/bootstrap/exchange":
                if content_type != "application/x-www-form-urlencoded":
                    raise Problem("invalid_content_type", 415)
                value = raw.decode("ascii")
                if re.search(r"%(?![0-9A-Fa-f]{2})", value):
                    raise Problem("invalid_payload", 422)
                body = strict_pairs(parse_qsl(value, keep_blank_values=True, strict_parsing=True))
                if set(body) != {"registration_id", "state", "bootstrap_grant"} or any(
                    not 1 <= len(v) <= 128 or not v.isascii() for v in body.values()
                ):
                    raise Problem("invalid_payload", 422)
            elif raw:
                if content_type != "application/json":
                    raise Problem("invalid_content_type", 415)
                body = json.loads(
                    raw.decode("utf-8"),
                    object_pairs_hook=strict_pairs,
                    parse_constant=lambda _: (_ for _ in ()).throw(Problem("invalid_payload", 422)),
                )
                if not isinstance(body, dict) or depth(body) > 16:
                    raise Problem("invalid_payload", 422)
        origin = str(request.base_url).rstrip("/")
        ctx = {
            "origin": origin,
            "request_origin": request.headers.get("origin"),
            "method": request.method,
            "cookie": cookies.get("__Host-aift"),
            "operator_cookie": cookies.get("__Host-aift-operator"),
            "registration_cookie": cookies.get("__Host-aift-registration"),
            "bootstrap_cookie": cookies.get("__Host-aift-bootstrap"),
            "csrf": request.headers.get("x-csrf-token", ""),
            "bearer": authorization[7:] if authorization else None,
            "peer": request.client.host if request.client else "",
            "forwarded": request.headers.get("x-forwarded-for"),
            "peer_key": service.secrets.keyed("abuse", request.client.host if request.client else ""),
        }
        if request.method not in {"GET", "HEAD"} and authorization:
            service.require_origin(ctx, True)
        query = strict_pairs(request.query_params.multi_items())

        def run():
            # Every host but the shared hosted address is its own company key; there the request's
            # own credential names the organization. Resolved before the lock so each organization
            # keeps its own lock instead of all sharing the registration one.
            if service.shared_address(ctx):
                with database.transaction(readonly=True) as lookup_session:
                    ctx["tenant_origin"] = service.resolve_tenant(lookup_session, ctx, path, body)
            else:
                ctx["tenant_origin"] = origin
            tenant_origin = ctx["tenant_origin"]
            # Registration/domain claims and operator changes serialize separately from tenant workloads.
            fixed = {settings.registration_origin, settings.operator_origin}
            if tenant_origin and tenant_origin not in fixed:
                lock_scope = tenant_origin
            else:
                lock_scope = "registration" if origin in fixed else origin
            if path.endswith("/otp/request") or path.endswith("/otp/resend"):
                lock_scope = "mail-budgets"
            if path.startswith("/v1/operator/organizations/"):
                with database.transaction(readonly=True) as lookup_session:
                    target = get(lookup_session, "company", path.split("/")[4])
                    if target:
                        lock_scope = target.data["origin"]
            # The configuration reads write only when the policy changed or an installation is
            # offered a new version. They run first without the organization's lock, which the
            # worker holds for its whole tick, and take it only when they must write.
            occasional_write = request.method == "GET" and path in {"/v1/config", "/v1/public/config"}
            readonly = request.method == "GET" and not path.startswith("/auth/bootstrap/") and not occasional_write
            result = None
            if occasional_write:
                try:
                    with database.read_attempt() as session:
                        result = service.handle(session, ctx, path, body, query)
                except WriteNeeded:
                    result = None
            if result is None:
                with database.transaction(scope=lock_scope, readonly=readonly) as session:
                    result = service.handle(session, ctx, path, body, query)
            if ctx.get("touch_session"):
                from sqlalchemy import update

                from .security import instant

                touched_at = instant(service.now())
                # Activity is independent of the repeatable-read response snapshot and immutable CSRF value.
                with database.transaction(scope="session-touch:" + ctx["touch_session"]) as session:
                    session.execute(
                        update(WebSession)
                        .where(WebSession.id == ctx["touch_session"], WebSession.last_seen_at < touched_at)
                        .values(last_seen_at=touched_at)
                    )
            return result

        result = await run_in_threadpool(run)
        if "_dispatch" in result:
            result = await run_in_threadpool(service.deliver, result["_dispatch"])
        if "_error" in result:
            return error(result["_error"], result.get("_status", 400))
        if "_export_stream" in result:
            correlation_id = str(uuid4())
            response = StreamingResponse(
                service.analytics.exports.stream(**result["_export_stream"], correlation_id=correlation_id),
                media_type="text/csv",
                headers={
                    "Content-Disposition": 'attachment; filename="company-usage.csv"',
                    "Content-Length": str(result["_export_length"]),
                    "X-Export-Integrity-SHA256": result["_export_integrity"],
                    "X-Export-Integrity-Algorithm": "sha256-chunk-chain-v1",
                    "X-Correlation-ID": correlation_id,
                },
            )
        elif "_csv" in result:
            response = Response(
                result["_csv"],
                media_type="text/csv",
                headers={"Content-Disposition": 'attachment; filename="company-usage.csv"'},
            )
        elif "_html" in result:
            response = HTMLResponse(
                result["_html"],
                headers={
                    "Content-Security-Policy": "default-src 'none'; form-action "
                    + result["_form_origin"]
                    + "; frame-ancestors 'none'",
                    # The organization host accepts this form only with the registration site's Origin.
                    # Under "no-referrer" browsers send Origin: null on a cross-origin POST, which
                    # refused every hand-over; "strict-origin" sends the origin and never the path.
                    "Referrer-Policy": "strict-origin",
                },
            )
        elif "_redirect" in result:
            response = RedirectResponse(result["_redirect"], status_code=303)
        else:
            response = JSONResponse({key: value for key, value in result.items() if not key.startswith("_")})
        for field, name in (
            ("_cookie", "__Host-aift"),
            ("_operator_cookie", "__Host-aift-operator"),
            ("_registration_cookie", "__Host-aift-registration"),
            ("_bootstrap_cookie", "__Host-aift-bootstrap"),
        ):
            if field in result:
                response.set_cookie(
                    name,
                    result[field],
                    secure=True,
                    httponly=True,
                    samesite="lax",
                    path="/",
                    # The organization cookie is only ever set after an administrator signs in.
                    max_age={
                        "_bootstrap_cookie": 300,
                        "_cookie": ADMIN_SESSION_SECONDS,
                        "_operator_cookie": OPERATOR_SESSION_SECONDS,
                    }.get(field, WEB_SESSION_SECONDS),
                )
        for field, name in (
            ("_clear_cookie", "__Host-aift"),
            ("_clear_operator", "__Host-aift-operator"),
            ("_clear_bootstrap", "__Host-aift-bootstrap"),
        ):
            if result.get(field):
                response.delete_cookie(name, secure=True, httponly=True, samesite="lax", path="/")
        return response

    return app


def production_app():
    return create_app()
