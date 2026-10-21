import hmac
import html
import math
import random
import re
import secrets
import time
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select

from . import dto
from .company_dedup import browser_key
from .db import TABLES, Device, EmailIdentity, Member, get, put, rows
from .free_mail import is_free_mail
from .policies import acknowledge, retention_preview, save_policy, usage_retention
from .security import (
    Problem,
    Secrets,
    canonical,
    digest,
    email_identity,
    folded_email,
    instant,
    normalize_domain,
    normalize_email,
    parse_time,
    token,
    uid,
)

# Code email limits. Each one counts the attempt whether or not a mail is sent, so a limit never
# tells a domain with an organization from one without (see issue_challenge).
NETWORK_MAIL_LIMITS = ((10, 900), (30, 86400))
RECIPIENT_MAIL_LIMITS = ((5, 900), (20, 86400))
# Registration codes go to domains nobody vouches for yet, so they get tighter limits of their own
# and only a share of the daily budget (settings.registration_mail_daily).
REGISTRATION_NETWORK_MAIL_LIMITS = ((3, 900), (10, 86400))
REGISTRATION_DOMAIN_MAIL_DAILY = 5


# Owner, 13 Oct 2026: a connected browser stays connected until the member disconnects or an
# administrator removes the member or the browser. Each refresh replaces the token, so only a
# browser unused for ten years would have to connect again.
REFRESH_SECONDS = 10 * 365 * 86400
REPLACED_REFRESH_SECONDS = 30 * 86400

# Owner, 14 Oct 2026: an organization administrator stays signed in on the website for 7 days from
# sign-in, with no shorter idle limit. This is safe only because every action that removes access,
# changes a role or deletes data still asks for a fresh email code (reauth), and sign-out, removal
# or suspension deletes the session at once.
ADMIN_SESSION_SECONDS = 7 * 86400
# Owner, 14 Oct 2026: the developer panel stays signed in for the same 7 days. It reaches every
# organization, so each change of an organization's status, plan, exception or domain approval and
# each deletion needs a fresh code sent to the configured developer address, and removing that
# address from the settings ends its sessions at once (operator_grant_revoked).
OPERATOR_SESSION_SECONDS = ADMIN_SESSION_SECONDS
WEB_SESSION_SECONDS = 86400
# Connection addresses are personal data, so the Network page needs a fresh email code too. One code
# opens the addresses for this session for 15 minutes, long enough to page and filter; signing out
# ends it with the session.
NETWORK_VIEW_SECONDS = 15 * 60
MEMBER_IDLE_SECONDS = 43200
OPERATOR_PURPOSES = {"operator_login", "operator_reauth"}
# The maintenance_cursor row with recent mail send times and the latest outcome (record_delivery).
MAIL_TIMING_KEY = "mail-delivery-timing"
# The maintenance_cursor row that records when person analytics was last switched on.
PERSON_ANALYTICS_KEY = "person-analytics-switch"


class Service:
    def __init__(self, settings, db, mail, clock=None):
        self.settings, self.db, self.mail = settings, db, mail
        self.secrets = Secrets(settings)
        self.clock = clock or (lambda: datetime.now(UTC))
        # An unsent code waits about as long as recent real sends (unsent_delivery). Tests replace
        # pause to avoid waiting.
        self.pause = time.sleep
        if settings.ip_collection_enabled:
            from .ip_rotation import initialize

            initialize(self)
        self.record_person_analytics_switch()

    def now(self):
        return self.clock()

    def record_person_analytics_switch(self):
        """
        Stores the moment person analytics is first seen on (person_analytics_enabled_since), and
        that it is off again when the setting is removed. Usage recorded while the switch was off is
        never shown by person afterwards, because members were told it would not be (owner decision
        of 18 October 2026). Switching off and on again starts a new period from the new moment.
        """
        enabled = self.settings.person_analytics_enabled
        with self.db.transaction(scope="person-analytics") as s:
            row = get(s, "maintenance_cursor", PERSON_ANALYTICS_KEY)
            was = bool(row and row.data.get("enabled"))
            if enabled and not was:
                put(s, "maintenance_cursor", PERSON_ANALYTICS_KEY, {"enabled": True, "since": instant(self.now())})
            elif was and not enabled:
                put(s, "maintenance_cursor", PERSON_ANALYTICS_KEY, {"enabled": False, "since": None})

    def person_analytics_since(self, s):
        """
        The instant from which per-person views may show usage, or None while person analytics is
        off. If the stored switch says off (another process switched it off), the answer is now, so
        nothing recorded earlier is shown.
        """
        if not self.settings.person_analytics_enabled:
            return None
        row = get(s, "maintenance_cursor", PERSON_ANALYTICS_KEY)
        if row and row.data.get("enabled") and row.data.get("since"):
            return row.data["since"]
        return instant(self.now())

    def features(self):
        # Read-only operator switches for the admin website. They sit outside policy(), so turning
        # one on or off does not change any organization's policy version.
        return {
            "person_analytics": self.settings.person_analytics_enabled,
            "ip_collection": self.settings.ip_collection_enabled,
        }

    def require_person_analytics(self):
        if not self.settings.person_analytics_enabled:
            raise Problem("not_found", 404)

    def refuse_person_filter(self, query):
        # With person analytics off no administrator query can name a person (owner decision of
        # 18 October 2026), so the server answers 400 rather than quietly ignoring the filter.
        if not self.settings.person_analytics_enabled and ("user_id" in query or "device_id" in query):
            raise Problem("person_analytics_disabled", 400)

    def expires(self, seconds):
        return instant(self.now() + timedelta(seconds=seconds))

    def alive(self, value):
        return bool(value) and parse_time(value) > self.now()

    def audit(self, s, tenant, actor, action, target, details=None, *, actor_kind="tenant"):
        put(
            s,
            "audit",
            uid(),
            {
                "actor": actor,
                "actor_kind": actor_kind,
                "action": action,
                "target": target,
                "at": instant(self.now()),
                "details": details or {},
            },
            tenant,
        )

    def tenant(self, s, origin, allow_inactive=False, grace=False):
        # No company key means a request at the shared hosted address that carried no credential
        # naming an organization: the person has to sign in or connect first.
        if not origin:
            raise Problem("authentication_required", 401)
        companies = TABLES["company"]
        tenant = s.scalar(select(companies).where(companies.origin == origin))
        if not tenant:
            raise Problem("unknown_company", 404)
        # During an organization's deletion grace period (grace=True) its administrators may still
        # sign in, read the deletion state and cancel it; nothing else is served.
        usable = {"active", "deletion_scheduled"} if grace else {"active"}
        if not allow_inactive and tenant.data["status"] not in usable:
            raise Problem("service_suspended", 403)
        return tenant

    def tenant_of(self, s, ctx, allow_inactive=False, grace=False):
        """The organization a request acts for: main.py resolves it before choosing the lock."""
        return self.tenant(
            s, ctx["tenant_origin"] if "tenant_origin" in ctx else ctx["origin"], allow_inactive, grace
        )

    def shared_address(self, ctx):
        """True at the hosted service's one public address, where only a credential names the organization."""
        return self.settings.mode == "hosted" and ctx["origin"] == self.settings.registration_origin

    def public_origin(self, company):
        # Hosted organizations all live at the one service address; their key is internal only.
        return self.settings.registration_origin if self.settings.mode == "hosted" else company.data["origin"]

    def resolve_tenant(self, s, ctx, path, body):
        """
        The company key a request at the shared hosted address acts for, from the credential the
        handler itself authenticates with, or None. Every other host is its own company key.
        """
        origin = ctx["origin"]
        if not self.shared_address(ctx):
            return origin

        def owner_of(kind, key, purpose=None):
            row = get(s, kind, key) if isinstance(key, str) and 0 < len(key) <= 128 else None
            if purpose and row and row.data.get("purpose") != purpose:
                row = None
            company = get(s, "company", row.tenant) if row and row.tenant else None
            return company.data["origin"] if company else None

        def body_digest(field):
            value = body.get(field)
            return digest(value) if isinstance(value, str) and value else None

        # These handlers ignore cookies and bearer tokens and authenticate only the body
        # credential, so that credential alone decides the organization (and the lock).
        if path == "/v1/auth/refresh":
            return owner_of("refresh", body_digest("refresh_token"))
        if path in {"/v1/connections/status", "/v1/connections/cancel", "/v1/connections/exchange"}:
            return owner_of("connection", body.get("connection_id"))
        if path in {"/v1/connections", "/v1/auth/otp/verify"}:
            return owner_of("otp", body.get("challenge_id"))
        if path in {"/v1/deletions/status", "/v1/deletions/ack"}:
            return owner_of("deletion_receipt", body.get("device_id"))
        # Registration and its hand-over must keep the shared registration lock whatever cookie
        # the browser still holds.
        if path.startswith(("/v1/organizations/", "/auth/bootstrap/")) or path in {
            "/v1/auth/bootstrap/exchange",
            "/v1/public/contact",
            "/v1/public/deployment",
        }:
            return None
        if ctx.get("bearer"):
            return owner_of("access", digest(ctx["bearer"]))
        if ctx.get("cookie"):
            return owner_of("session", digest(ctx["cookie"]), "tenant")
        return None

    def domain_company(self, s, email, admin=False):
        """
        The one active organization registered with this email's domain, or None. Administrators
        still find an organization scheduled for deletion, so they can sign in and cancel it.
        """
        companies = TABLES["company"]
        usable = {"active", "deletion_scheduled"} if admin else {"active"}
        candidates = [
            company
            for company in s.scalars(select(companies).where(companies.domain == email.split("@")[1]))
            if company.data["status"] in usable
        ]
        if len(candidates) > 1:
            # An operator domain exception lets a second organization share a domain. Only an
            # existing membership tells them apart; a new address on a shared domain stays unassigned.
            candidates = [company for company in candidates if self.known_member(s, company, email, admin)]
        return candidates[0] if len(candidates) == 1 else None

    def email_record(self, s, company, email):
        """
        The stored identity of this person in the organization, or None. Rows are keyed by
        email_identity since migration 0014; an erased member keeps a row under the exact address
        it was created with, so that key still blocks the same address from joining again.
        """
        identity = get(s, "email", self.secrets.keyed("email:" + company.id, email_identity(email)), company.id)
        if identity:
            return identity
        legacy = get(s, "email", self.secrets.keyed("email:" + company.id, normalize_email(email)), company.id)
        member = get(s, "member", legacy.owner, company.id) if legacy else None
        return legacy if member and member.data["status"] == "deleted" else None

    def known_member(self, s, company, email, admin=False):
        identity = self.email_record(s, company, email)
        member = get(s, "member", identity.owner, company.id) if identity else None
        return bool(
            member and member.data["status"] == "active" and (not admin or member.data["role"] == "admin")
        )

    def shared_company(self, s, ctx, email, admin=False):
        """
        Finds the organization for an email code requested at the shared address. The answer never
        depends on whether one exists, so the request cannot list which domains have an organization.
        """
        domain = email.split("@")[1]
        if is_free_mail(domain):
            raise Problem("work_email_required", 400)
        # Mail budgets count per email domain whether or not an organization uses it, so their
        # limits do not reveal it either.
        return self.domain_company(s, email, admin), ctx["origin"] + ":domain:" + domain

    def policy(self, company):
        from footprint_estimator import BASELINE_METHOD_HASH, BASELINE_METHOD_ID
        from sqlalchemy.orm import object_session

        from .method_registry import inventory

        session = object_session(company)
        methods = (
            inventory(session)["methods"]
            if session is not None
            else [{"method_id": BASELINE_METHOD_ID, "method_hash": BASELINE_METHOD_HASH}]
        )
        return {
            "policy_version": company.data["policy_version"],
            "disclosure_version": "1.0.0",
            "timezone": company.data["timezone"],
            "pause_mode": company.data["pause_mode"],
            "company_sharing": company.data["company_sharing"],
            # With IP collection off no address is stored. Extensions released before 18 October 2026
            # require an integer here, so the field stays and says zero days.
            "ip_retention_days": self.settings.ip_retention_days if self.settings.ip_collection_enabled else 0,
            "usage_retention_months": usage_retention(company.data),
            "deletion_epoch": company.data["epoch"],
            "supported_schema_versions": ["3.0.0"],
            "supported_result_schema_versions": ["3.0.0"],
            "supported_history_schema_versions": ["3.0.0"],
            "engine_selection_schema_version": "1.0.0",
            "mode": self.settings.mode,
            "supported_methods": [
                {"method_id": m["method_id"], "method_hash": m["method_hash"]} for m in methods
            ],
        }

    def rate(self, s, scope, limit, seconds, consume=True):
        """
        Counts one request against a limit and refuses it once the limit is reached. With
        consume=False it only checks, for a request that would answer alike without using the budget.
        """
        key = self.secrets.keyed("rate", scope)
        row = get(s, "rate", key)
        times = [
            t
            for t in (row.data["times"] if row else [])
            if parse_time(t) > self.now() - timedelta(seconds=seconds)
        ]
        if len(times) >= limit:
            # The request can succeed once enough counted requests have left the window: when
            # the oldest of the last `limit` does. The website says when to try again.
            oldest = min(parse_time(t) for t in sorted(times)[-limit:])
            wait = math.ceil((oldest + timedelta(seconds=seconds) - self.now()).total_seconds())
            raise Problem(
                "otp_rate_limited" if scope.startswith("mail") else "rate_limited",
                429,
                True,
                retry_after=max(1, wait),
            )
        if consume:
            put(s, "rate", key, {"times": [*times, instant(self.now())]})

    def member(self, s, company, email, first_admin=False):
        lookup = self.secrets.keyed("email:" + company.id, email_identity(email))
        identity = self.email_record(s, company, email)
        if identity:
            member = get(s, "member", identity.owner, company.id)
            if not member or member.data["status"] != "active":
                raise Problem("identity_unavailable", 403)
            return member
        if (
            s.scalar(
                select(func.count())
                .select_from(Member)
                .where(Member.tenant == company.id, Member.status == "active")
            )
            >= company.data["capacity"]
        ):
            raise Problem("capacity_reached", 409)
        user = uid()
        member = put(
            s,
            "member",
            user,
            {
                "status": "active",
                "role": "admin" if first_admin else "user",
                "version": 1,
                "created_at": instant(self.now()),
                "hmac_key": self.secrets.encrypt(token()),
            },
            company.id,
            user,
        )
        put(s, "email", lookup, {"email": self.secrets.encrypt(email)}, company.id, user)
        return member

    def session(
        self, s, company, member, purpose="tenant", registration=None, operator_identity=None, csrf=None
    ):
        raw, csrf = token(), csrf or token()
        role = member.data["role"] if member else "operator"
        if purpose == "operator":
            lifetime = OPERATOR_SESSION_SECONDS
        elif purpose == "tenant" and role == "admin":
            lifetime = ADMIN_SESSION_SECONDS
        else:
            lifetime = WEB_SESSION_SECONDS
        put(
            s,
            "session",
            digest(raw),
            {
                "purpose": purpose,
                "csrf": digest(csrf),
                "csrf_secret": self.secrets.encrypt(csrf),
                "expires": self.expires(lifetime),
                "last_seen": instant(self.now()),
                "created_at": instant(self.now()),
                "role_at_login": role,
                "registration": registration,
            },
            company.id if company else "",
            member.id if member else operator_identity,
        )
        return raw, csrf

    def operator_emails(self):
        """Maps each approved developer identity to its email; a removed email no longer resolves."""
        from uuid import UUID

        return {
            str(UUID(self.secrets.keyed("operator-identity", normalize_email(email))[:32])): normalize_email(email)
            for email in self.settings.operator_emails
        }

    def operator_identity(self, address):
        """The stable developer identity of a configured developer address."""
        from uuid import UUID

        return str(UUID(self.secrets.keyed("operator-identity", normalize_email(address))[:32]))

    def operator_address(self, email):
        """
        The configured developer address this email names, or None. Only case is ignored: a "+tag"
        may be a separate mailbox on some mail servers, so a tagged variant never matches. The code
        goes to the configured address and the identity stays derived from it.
        """
        wanted = folded_email(email)
        for value in self.settings.operator_emails:
            if folded_email(value) == wanted:
                return normalize_email(value)
        return None

    def delivery_address(self, s, company, email):
        """
        Where a code for this address goes. email_identity counts Bob@, bob@ and bob+x@ as one
        person, but on some mail servers they are separate mailboxes, so a code that can act as an
        existing member goes only to the address that member is stored with. A new person gets
        the address they typed, which is then stored.
        """
        record = self.email_record(s, company, email) if company is not None else None
        stored = record.data.get("email") if record else None
        return self.secrets.decrypt(stored) if stored else email

    def principal(self, s, ctx, admin=False, operator=False, web_only=False, grace=False):
        origin = ctx["origin"]
        if operator:
            if origin != self.settings.operator_origin:
                raise Problem("origin_mismatch", 403)
            company = None
        else:
            company = self.tenant_of(s, ctx, grace=grace)
        bearer = ctx.get("bearer")
        if bearer and not web_only and not operator and not admin:
            cred = get(s, "access", digest(bearer), company.id)
            if not cred or not self.alive(cred.data["expires"]):
                raise Problem("authentication_required", 401)
            device = get(s, "device", cred.data["device"], company.id)
            family = get(s, "family", cred.data["family"], company.id)
            member = get(s, "member", cred.owner, company.id)
            if (
                not device
                or device.data["status"] != "active"
                or not family
                or family.data["revoked"]
                or not member
                or member.data["status"] != "active"
            ):
                raise Problem("enrollment_revoked", 403)
            return company, member, device
        raw = ctx.get("operator_cookie" if operator else "cookie")
        if raw and ctx.get("request_origin") not in {None, origin}:
            raise Problem("origin_mismatch", 403)
        session = get(s, "session", digest(raw)) if raw else None
        expected = "operator" if operator else "tenant"
        if (
            not session
            or session.data["purpose"] != expected
            or not self.alive(session.data["expires"])
            or (company and session.tenant != company.id)
        ):
            raise Problem("authentication_required", 401)
        if operator:
            from uuid import UUID

            grants = {
                str(UUID(self.secrets.keyed("operator-identity", normalize_email(email))[:32]))
                for email in self.settings.operator_emails
            }
            if session.owner not in grants:
                raise Problem("operator_grant_revoked", 403)
        member = get(s, "member", session.owner, company.id) if company else None
        if company and (not member or member.data["status"] != "active"):
            raise Problem("authentication_required", 401)
        # A session made before 14 Oct 2026 keeps its stored 24-hour expiry; only the idle limit grows.
        if operator:
            idle = OPERATOR_SESSION_SECONDS
        elif member and member.data["role"] == "admin":
            idle = ADMIN_SESSION_SECONDS
        else:
            idle = MEMBER_IDLE_SECONDS
        if parse_time(session.last_seen_at) < self.now() - timedelta(seconds=idle):
            raise Problem("authentication_required", 401)
        if admin and member.data["role"] != "admin":
            raise Problem("admin_required", 403)
        if ctx["method"] not in {"GET", "HEAD"}:
            if ctx.get("request_origin") != origin or not hmac.compare_digest(
                session.data["csrf"], digest(ctx.get("csrf", ""))
            ):
                raise Problem("csrf_failed", 403)
        if ctx["method"] == "GET":
            ctx["touch_session"] = session.id
        else:
            session.last_seen_at = instant(self.now())
        ctx["session"] = session
        return company, member, None

    def require_origin(self, ctx, extension=False):
        from .security import extension_origin_allowed

        supplied = ctx.get("request_origin")
        allowed = {ctx["origin"]}
        if extension:
            if supplied is None or extension_origin_allowed(supplied, self.settings.extension_origins):
                return
        if supplied not in allowed:
            raise Problem("origin_mismatch", 403)

    def registration(self, s, ctx, body):
        self.require_origin(ctx)
        if ctx["origin"] != self.settings.registration_origin:
            raise Problem("origin_mismatch", 403)
        data = dto.Registration.model_validate_json(canonical(body)).model_dump(mode="json")
        domain, email = normalize_domain(data["work_domain"]), normalize_email(data["admin_email"])
        if email.split("@")[1] != domain or is_free_mail(domain):
            raise Problem("domain_review_required", 422)
        operation = digest(
            canonical(["registration", ctx["origin"], email_identity(email), data["idempotency_key"]])
        )
        existing = get(s, "registration_operation", operation)
        if existing:
            if existing.data["hash"] != digest(canonical(data)):
                raise Problem("idempotency_conflict", 409)
            row = get(s, "registration", existing.data["registration"])
            return self.registration_result(row)
        self.rate(s, "registration:" + ctx["peer_key"], 10, 3600)
        approval = get(s, "domain_claim", self.domain_claim_key(domain))
        approved = (
            approval and approval.data["status"] == "approved" and self.alive(approval.data["expires_at"])
        )
        # Members are assigned by their email domain, so one hosted organization per domain unless
        # the developer approved an exception for it.
        conflict = pending = None
        if not approved:
            companies, drafts = TABLES["company"], TABLES["registration"]
            conflict = s.scalar(select(companies.id).where(companies.domain == domain).limit(1))
            pending = s.scalar(
                select(drafts.id)
                .where(
                    drafts.data["expires"].as_string() > instant(self.now()),
                    drafts.data["domain"].as_string() == domain,
                )
                .limit(1)
            )
        if conflict or pending:
            raise Problem("organization_review_required", 409)
        registration = uid()
        row = put(
            s,
            "registration",
            registration,
            {
                "domain": domain,
                "contact": self.secrets.encrypt(data),
                "email": self.secrets.encrypt(email),
                "expires": self.expires(1800),
                "state": "verification_pending",
                "domain_approval": approval.id if approved else None,
            },
        )
        put(
            s,
            "registration_operation",
            operation,
            {"hash": digest(canonical(data)), "registration": registration},
        )
        return self.registration_result(row)

    def domain_claim_key(self, domain):
        # Registrations no longer choose an address, so a developer's exception names the domain only.
        return digest("domain-claim:" + domain)

    def registration_result(self, row):
        return {
            "registration_id": row.id,
            "state": row.data["state"],
            "expires_at": row.data["expires"],
            "next_step": "verify_email",
        }

    def request_otp(self, s, ctx, body, operator=False):
        self.require_origin(ctx)
        data = dto.OTPRequest.model_validate_json(canonical(body)).model_dump(mode="json")
        email = normalize_email(data["email"])
        purpose = data["purpose"]
        company, owner = None, ""
        if operator:
            if ctx["origin"] != self.settings.operator_origin or purpose not in OPERATOR_PURPOSES:
                raise Problem("origin_mismatch", 403)
            email = self.operator_address(email)
            if not email:
                raise Problem("identity_unavailable", 403)
            if purpose == "operator_reauth":
                # An action code goes only to the configured address of the developer signed in here.
                self.principal(s, ctx, operator=True, web_only=True)
                owner = ctx["session"].owner
                if self.operator_identity(email) != owner:
                    raise Problem("identity_unavailable", 403)
        elif purpose == "registration":
            if ctx["origin"] != self.settings.registration_origin:
                raise Problem("origin_mismatch", 403)
            registration = get(s, "registration", data["registration_id"])
            if (
                not registration
                or registration.data.get("company")
                or not self.alive(registration.data["expires"])
                or email_identity(self.secrets.decrypt(registration.data["email"])) != email_identity(email)
            ):
                raise Problem("registration_unavailable", 400)
        else:
            if purpose not in {"login", "action_reauth"} or data["registration_id"]:
                raise Problem("invalid_purpose", 400)
            if purpose == "login" and self.shared_address(ctx):
                # Administrators sign in at the one hosted address: the email domain names the
                # organization. Without one no code is sent, and the answer is the same as with one.
                company, scope = self.shared_company(s, ctx, email, admin=True)
                return self.issue_challenge(
                    s, ctx, email, purpose, company, "", data["dispatch_id"], None, scope, send=bool(company)
                )
            company = self.tenant_of(s, ctx, grace=purpose == "login")
            if email.split("@")[1] != company.data["domain"]:
                raise Problem("identity_unavailable", 403)
            if purpose == "action_reauth":
                _, member, _ = self.principal(s, ctx, web_only=True)
                identity = self.email_record(s, company, email)
                if not identity or identity.owner != member.id:
                    raise Problem("identity_unavailable", 403)
                owner = member.id
        return self.issue_challenge(
            s, ctx, email, purpose, company, owner, data["dispatch_id"], data["registration_id"]
        )

    def connection_otp(self, s, ctx, body):
        """Step 1 of connecting a browser: email a code to the member's work address."""
        self.require_origin(ctx, True)
        data = dto.ConnectionOTPRequest.model_validate_json(canonical(body)).model_dump(mode="json")
        email = normalize_email(data["email"])
        if self.shared_address(ctx):
            company, scope = self.shared_company(s, ctx, email)
        else:
            company = self.tenant_of(s, ctx)
            if is_free_mail(email.split("@")[1]):
                raise Problem("work_email_required", 400)
            scope = company.id
            if email.split("@")[1] != company.data["domain"]:
                # Answered like a match without sending a code, as the shared address does.
                company = None
        return self.issue_challenge(
            s, ctx, email, "connect", company, "", data["dispatch_id"], None, scope, send=bool(company)
        )

    def issue_challenge(
        self, s, ctx, email, purpose, company, owner, dispatch_id, registration_id, scope=None, send=True
    ):
        """
        Creates an email code. With send=False (a sign-in or connection for a domain without an
        organization) nothing is mailed, but the request is counted and answered exactly as a sent
        one: same limits, same stored challenge, same reply and a delivery step of similar duration.
        Mailing such codes let one address use up the day's mail budget for everyone (S1).
        """
        scope = (scope or (company.id if company else ctx["origin"])) + ":" + purpose
        data = {"dispatch_id": dispatch_id, "registration_id": registration_id}
        dispatch_key = digest(scope + ":" + data["dispatch_id"])
        prior = get(s, "dispatch", dispatch_key)
        binding = self.secrets.keyed(scope, email_identity(email) + ":" + str(data["registration_id"]))
        if prior:
            if prior.data["binding"] != binding:
                raise Problem("idempotency_conflict", 409)
            previous = get(s, "otp", prior.data["challenge"])
            result = self.challenge_result(previous)
            if previous.data["delivery"] == "pending":
                result["_dispatch"] = previous.id
            return result
        # An unsent code only checks the shared budget, so it can never use it up, yet it is refused
        # alike once real mail has used it up.
        self.rate(s, "mail-global", self.settings.global_mail_daily, 86400, consume=send)
        if purpose == "registration":
            # Anyone can start a registration for a new domain, so registration mail has its own
            # share of the daily budget; the rest stays for people of existing organizations.
            domain = email.split("@")[1]
            self.rate(s, "mail-registration-global", self.settings.registration_mail_daily, 86400)
            self.rate(s, "mail-registration-domain:" + domain, REGISTRATION_DOMAIN_MAIL_DAILY, 86400)
            for limit, seconds in REGISTRATION_NETWORK_MAIL_LIMITS:
                self.rate(s, f"mail-registration-network-{seconds}:" + ctx["peer_key"], limit, seconds)
        else:
            self.rate(s, "mail-tenant:" + scope, self.settings.tenant_mail_daily, 86400)
        for (limit, seconds), name in zip(RECIPIENT_MAIL_LIMITS, ("short", "day"), strict=True):
            self.rate(s, f"mail-recipient-{name}:" + binding, limit, seconds)
        for limit, seconds in NETWORK_MAIL_LIMITS:
            self.rate(s, f"mail-network-{seconds}:" + ctx["peer_key"], limit, seconds)
        # Counting above uses the identity; the mail itself goes to the member's own stored address.
        email = self.delivery_address(s, company, email)
        challenge, code = uid(), f"{secrets.randbelow(1000000):06d}"
        challenge_data = {
            "purpose": purpose,
            "origin": ctx["origin"],
            "email": self.secrets.encrypt(email),
            "mac": self.secrets.keyed("otp:" + challenge, code),
            "expires": self.expires(300),
            "issued": instant(self.now()),
            "attempts": 0,
            "consumed": False,
            "registration": data["registration_id"],
            "delivery": "pending",
            # Whether a mail goes out is inside the encrypted payload, so the stored row reads alike.
            "send_payload": self.secrets.encrypt({"email": email, "code": code, "send": send}),
        }
        row = put(s, "otp", challenge, challenge_data, company.id if company else "", owner)
        put(s, "dispatch", dispatch_key, {"binding": binding, "challenge": challenge})
        return {**self.challenge_result(row), "_dispatch": row.id}

    def deliver(self, challenge):
        # Commit the dispatch claim before crossing the mail-provider boundary. A crashed in-flight
        # delivery becomes unknown, never a fresh redeemable code or an automatic duplicate send.
        with self.db.transaction(scope="mail-dispatch:" + challenge) as s:
            row = get(s, "otp", challenge)
            if not row or not self.alive(row.data["expires"]):
                raise Problem("otp_invalid_or_expired", 401)
            if row.data["delivery"] != "pending":
                return self.challenge_result(row)
            payload = self.secrets.decrypt(row.data["send_payload"])
            purpose = row.data["purpose"]
            row.data = {**row.data, "delivery": "delivery_unknown", "send_payload": ""}
        try:
            if payload.get("send", True):
                started = time.perf_counter()
                try:
                    delivery = self.mail.send(payload["email"], payload["code"], purpose)
                except Problem:
                    delivery = "failed"
                self.record_delivery(time.perf_counter() - started, delivery)
            else:
                delivery = self.unsent_delivery()
        finally:
            payload.clear()
        with self.db.transaction(scope="mail-dispatch:" + challenge) as s:
            row = get(s, "otp", challenge)
            row.data = {**row.data, "delivery": delivery}
            return self.challenge_result(row)

    def record_delivery(self, seconds, delivery):
        """
        Keeps the last 50 send times and the latest outcome in the database. The API runs several
        processes, and an unsent code in one must look like a real send in any other.
        """
        with self.db.transaction(scope=MAIL_TIMING_KEY) as s:
            row = get(s, "maintenance_cursor", MAIL_TIMING_KEY)
            durations = [*(row.data["durations"] if row else []), round(seconds, 4)][-50:]
            put(
                s,
                "maintenance_cursor",
                MAIL_TIMING_KEY,
                {"durations": durations, "last": delivery, "at": instant(self.now())},
            )

    def unsent_delivery(self):
        """
        Stands in for a mail provider call that is not made: it takes about as long as recent real
        sends and reports what the last one reported while that is recent, so neither the time nor
        an outage shows that no mail went out.
        """
        with self.db.transaction(readonly=True) as s:
            row = get(s, "maintenance_cursor", MAIL_TIMING_KEY)
            timing = dict(row.data) if row else {"durations": [], "last": "accepted", "at": None}
        recent = timing["durations"]
        self.pause(random.choice(recent) if recent else random.uniform(0.2, 0.5))
        current = timing["at"] and parse_time(timing["at"]) > self.now() - timedelta(seconds=600)
        return timing["last"] if current else "accepted"

    def challenge_result(self, row):
        return {
            "challenge_id": row.id,
            "delivery_state": row.data["delivery"],
            "expires_at": row.data["expires"],
            "retry_at": instant(parse_time(row.data["issued"]) + timedelta(seconds=60)),
            "error_code": "email_service_unavailable" if row.data["delivery"] == "failed" else None,
        }

    def verify_otp(self, s, ctx, body, operator=False):
        self.require_origin(ctx)
        data = dto.OTPVerify.model_validate_json(canonical(body)).model_dump(mode="json")
        row = get(s, "otp", data["challenge_id"])
        if (
            not row
            or row.data["origin"] != ctx["origin"]
            or (row.data["purpose"] in OPERATOR_PURPOSES) != operator
            # A connection code is redeemed only by creating the connection.
            or row.data["purpose"] == "connect"
        ):
            raise Problem("otp_invalid_or_expired", 401)
        if row.data["consumed"]:
            binding = self.secrets.keyed(
                "otp-verification-replay",
                canonical([ctx["origin"], row.id, data["verification_id"], data["code"]]),
            )
            if (
                not self.alive(row.data["expires"])
                or not row.data.get("verification_result")
                or not hmac.compare_digest(binding, row.data.get("verification_binding", ""))
            ):
                raise Problem("otp_invalid_or_expired", 401)
            result = self.secrets.decrypt(row.data["verification_result"])
            purpose = row.data["purpose"]
            if purpose in {"login", "operator_login"}:
                company = get(s, "company", row.tenant) if row.tenant else None
                replay_ctx = {
                    **ctx,
                    "method": "GET",
                    "cookie": result.get("_cookie"),
                    "operator_cookie": result.get("_operator_cookie"),
                    "bearer": None,
                    "tenant_origin": company.data["origin"] if company else None,
                }
                _, current_member, _ = self.principal(
                    s, replay_ctx, operator=operator, web_only=True, grace=True
                )
                if current_member and current_member.data["role"] != "admin":
                    raise Problem("admin_required", 403)
            elif purpose == "registration":
                session = get(s, "session", digest(result["_registration_cookie"]))
                registration = get(s, "registration", row.data["registration"])
                member = get(s, "member", session.owner, session.tenant) if session else None
                if (
                    not session
                    or session.data["purpose"] != "registration"
                    or not self.alive(session.data["expires"])
                    or not registration
                    or session.data["registration"] != registration.id
                    or not member
                    or member.data["status"] != "active"
                    or member.data["role"] != "admin"
                ):
                    raise Problem("otp_invalid_or_expired", 401)
            else:
                if purpose == "operator_reauth":
                    self.principal(s, ctx, operator=True, web_only=True)
                    tenant, owner = "", ctx["session"].owner
                else:
                    company, member, _ = self.principal(s, ctx, web_only=True)
                    tenant, owner = company.id, member.id
                proof = get(s, "reauth", digest(result["reauth_token"]), tenant)
                if (
                    not proof
                    or proof.owner != owner
                    or proof.data["used"]
                    or not self.alive(proof.data["expires"])
                ):
                    raise Problem("otp_invalid_or_expired", 401)
            return result
        if (
            row.data["consumed"]
            or not self.alive(row.data["expires"])
            or row.data["attempts"] >= 5
            or row.data["delivery"] in {"failed", "pending"}
        ):
            raise Problem("otp_invalid_or_expired", 401)
        if not hmac.compare_digest(row.data["mac"], self.secrets.keyed("otp:" + row.id, data["code"])):
            row.data = {**row.data, "attempts": row.data["attempts"] + 1}
            return {"_error": "otp_invalid_or_expired", "_status": 401}
        email = self.secrets.decrypt(row.data["email"])
        purpose = row.data["purpose"]
        if purpose == "operator_login":
            configured = self.operator_address(email)
            if not configured:
                raise Problem("identity_unavailable", 403)
            operator_id = self.operator_identity(configured)
            raw, csrf = self.session(s, None, None, "operator", operator_identity=operator_id)
            result = {"destination": "/operator", "csrf_token": csrf, "_operator_cookie": raw}
        elif purpose == "operator_reauth":
            # Developer actions are not tied to an organization, so the code is stored without one.
            self.principal(s, ctx, operator=True, web_only=True)
            if row.owner != ctx["session"].owner:
                raise Problem("identity_unavailable", 403)
            proof = token()
            put(
                s,
                "reauth",
                digest(proof),
                {"expires": self.expires(300), "used": False},
                "",
                ctx["session"].owner,
            )
            result = {"reauth_token": proof, "expires_at": self.expires(300)}
        elif purpose == "registration":
            registration = get(s, "registration", row.data["registration"])
            if not registration or not self.alive(registration.data["expires"]):
                raise Problem("registration_unavailable", 400)
            approval = (
                get(s, "domain_claim", registration.data.get("domain_approval"))
                if registration.data.get("domain_approval")
                else None
            )
            duplicate_domain = s.scalar(
                select(TABLES["company"].id)
                .where(TABLES["company"].domain == registration.data["domain"])
                .limit(1)
            )
            if duplicate_domain and (
                not approval
                or approval.data["status"] != "approved"
                or not self.alive(approval.data["expires_at"])
            ):
                raise Problem("organization_review_required", 409)
            if self.settings.mode == "self_hosted" and rows(s, "company"):
                raise Problem("single_tenant_only", 409)
            company_id = uid()
            contact = self.secrets.decrypt(registration.data["contact"])
            # The key stays a unique internal identifier. Hosted organizations are never served at
            # it: they share the one service address and are told apart by their credentials.
            internal = company_id.replace("-", "")
            origin = (
                self.settings.self_host_origin
                if self.settings.mode == "self_hosted"
                else "https://" + internal + "." + self.settings.hosted_domain
            )
            company = put(
                s,
                "company",
                company_id,
                {
                    "name": contact["company_name"],
                    "slug": internal,
                    "domain": registration.data["domain"],
                    "origin": origin,
                    "status": "active" if self.settings.routing_verified else "provisioning_failed",
                    "timezone": "UTC",
                    "pause_mode": "user_controlled",
                    "company_sharing": "disabled",
                    "capacity": self.settings.member_capacity,
                    # Hosted free keeps usage until an administrator deletes it (owner decision, 11 Oct 2026);
                    # administrators can choose a shorter period under Policies.
                    "retention_months": None,
                    "policy_version": "1.0.0",
                    "epoch": 0,
                    "version": 1,
                    "plan_id": "self-hosted" if self.settings.mode == "self_hosted" else "configured-free",
                    "plan_version": 1,
                },
            )
            member = self.member(s, company, email, True)
            if approval:
                approval.data = {
                    **approval.data,
                    "status": "consumed",
                    "company_id": company.id,
                    "consumed_at": instant(self.now()),
                }
                self.audit(
                    s,
                    company.id,
                    member.id,
                    "domain_exception_consumed",
                    approval.id,
                    {"reviewer_id": approval.data["reviewer_id"], "version": approval.data["version"]},
                )
            registration.data = {
                **registration.data,
                "company": company_id,
                "user": member.id,
                "state": company.data["status"],
            }
            raw, csrf = self.session(s, company, member, "registration", registration.id)
            result = {
                "registration_id": registration.id,
                "state": company.data["status"],
                "company_origin": self.public_origin(company),
                "csrf_token": csrf,
                "_registration_cookie": raw,
            }
            if self.settings.mode == "hosted":
                # The dashboard lives at this same address, so the administrator is signed in here
                # directly. Both sessions share one CSRF token so the page needs only one.
                tenant_raw, _ = self.session(s, company, member, csrf=csrf)
                result.update(destination="/admin", _cookie=tenant_raw)
            else:
                result["destination"] = origin + "/auth/bootstrap/start?registration_id=" + registration.id
            self.audit(s, company.id, member.id, "organization_registered", company.id)
        elif purpose == "action_reauth":
            company, member, _ = self.principal(s, ctx, web_only=True)
            if row.owner != member.id:
                raise Problem("identity_unavailable", 403)
            proof = token()
            put(
                s,
                "reauth",
                digest(proof),
                {"expires": self.expires(300), "used": False},
                company.id,
                member.id,
            )
            result = {"reauth_token": proof, "expires_at": self.expires(300)}
        else:
            company = self.challenge_company(s, row, grace=True)
            # The website is for administrators only; members connect from the extension, and a
            # web sign-in never creates a member.
            if not self.known_member(s, company, email, admin=True):
                raise Problem("admin_required", 403)
            member = self.member(s, company, email)
            raw, csrf = self.session(s, company, member)
            result = {
                "destination": "/admin",
                "csrf_token": csrf,
                "role": member.data["role"],
                "_cookie": raw,
            }
        row.data = {
            **row.data,
            "consumed": True,
            "mac": "",
            "email": "",
            "verification_binding": self.secrets.keyed(
                "otp-verification-replay",
                canonical([ctx["origin"], row.id, data["verification_id"], data["code"]]),
            ),
            "verification_result": self.secrets.encrypt(result),
        }
        return result

    def reauth(self, s, company, member, proof):
        self.spend_code(s, company.id, member.id, proof)

    def operator_reauth(self, s, ctx, proof):
        """Spends a developer's single-use action code; principal(operator=True) ran first."""
        self.spend_code(s, "", ctx["session"].owner, proof)

    def spend_code(self, s, tenant, owner, proof):
        row = get(s, "reauth", digest(proof), tenant)
        if not row or row.owner != owner or row.data["used"] or not self.alive(row.data["expires"]):
            raise Problem("reauthentication_required", 403)
        row.data = {**row.data, "used": True}

    def admin_operation(self, s, company, actor, kind, data):
        """
        Looks up an administrator action by its idempotency key. Returns the stored key, the request
        fingerprint and the earlier answer (None the first time). The single-use code is left out of
        the fingerprint, so a retry of an action that already happened replays its answer whichever
        code it carries; only this administrator's own action can replay. The answers share the
        role_operations table with role changes, keyed by action so one key cannot cross actions.
        """
        operation = digest(":".join([company.id, actor.id, kind, str(data["idempotency_key"])]))
        request_hash = digest(canonical({k: v for k, v in data.items() if k != "reauth_token"}))
        prior = get(s, "role_operation", operation, company.id)
        if prior and prior.data["hash"] != request_hash:
            raise Problem("idempotency_conflict", 409)
        return operation, request_hash, prior.data["result"] if prior else None

    def remember_operation(self, s, company, actor, operation, request_hash, result):
        put(s, "role_operation", operation, {"hash": request_hash, "result": result}, company.id, actor.id)
        return result

    def challenge_company(self, s, row, grace=False):
        """The organization an email code was issued for; reported only after the code is verified."""
        company = get(s, "company", row.tenant) if row.tenant else None
        if not company:
            raise Problem("organization_not_found", 404)
        return self.tenant(s, company.data["origin"], grace=grace)

    def connection_create(self, s, ctx, body):
        """Step 2: the member's email code proves who connects, so no web approval is needed."""
        self.require_origin(ctx, True)
        data = dto.ConnectionCreate.model_validate_json(canonical(body)).model_dump(mode="json")
        challenge = get(s, "otp", data["challenge_id"])
        if not challenge or challenge.data["origin"] != ctx["origin"] or challenge.data["purpose"] != "connect":
            raise Problem("otp_invalid_or_expired", 401)
        key = digest(challenge.tenant + ":" + data["operation_id"])
        prior = get(s, "connection_operation", key) if challenge.tenant else None
        if prior:
            # The request hash covers the code, so only the sender of the first request gets its answer.
            if prior.data["hash"] != digest(canonical(data)):
                raise Problem("idempotency_conflict", 409)
            company = self.challenge_company(s, challenge)
            return self.connection_result(get(s, "connection", prior.data["connection"], company.id), company)
        self.rate(s, "connection:" + ctx["peer_key"], 50, 3600)
        if (
            challenge.data["consumed"]
            or not self.alive(challenge.data["expires"])
            or challenge.data["attempts"] >= 5
            or challenge.data["delivery"] in {"failed", "pending"}
        ):
            raise Problem("otp_invalid_or_expired", 401)
        if not hmac.compare_digest(challenge.data["mac"], self.secrets.keyed("otp:" + challenge.id, data["code"])):
            challenge.data = {**challenge.data, "attempts": challenge.data["attempts"] + 1}
            return {"_error": "otp_invalid_or_expired", "_status": 401}
        company = self.challenge_company(s, challenge)
        email = self.secrets.decrypt(challenge.data["email"])
        identity = self.email_record(s, company, email)
        if identity:
            member = get(s, "member", identity.owner, company.id)
            if not member or member.data["status"] != "active":
                raise Problem("member_unavailable", 403)
        else:
            member = self.member(s, company, email)
        resume = data["resume_device_id"]
        if resume:
            device = get(s, "device", resume, company.id)
            if not device or (device.owner == member.id and device.data["status"] == "revoked"):
                # A browser last connected to another organization, or one whose record is gone,
                # connects as a new browser. So does one an administrator or the member removed:
                # the email code proves the person again, and the removed browser stays removed.
                resume = None
            elif (
                device.owner != member.id
                or device.data["status"] in {"revoked", "deleted"}
                or not hmac.compare_digest(
                    device.data["reconnect"], digest(data["installation_reconnect_secret"])
                )
            ):
                raise Problem("connection_denied", 403)
        challenge.data = {**challenge.data, "consumed": True, "mac": "", "email": ""}
        save_policy(self, s, company)
        connection = uid()
        row = put(
            s,
            "connection",
            connection,
            {
                "challenge": data["verifier_challenge"],
                "browser": data["browser_family"],
                "expires": self.expires(600),
                "state": "verified",
                "resume": resume,
                "last_poll": None,
            },
            company.id,
            member.id,
        )
        put(
            s,
            "connection_operation",
            key,
            {"hash": digest(canonical(data)), "connection": connection},
            company.id,
        )
        return self.connection_result(row, company)

    def connection_result(self, row, company):
        recoverable = row.data["state"] == "consumed" and self.alive(row.data.get("cache_expires"))
        return {
            "connection_id": row.id,
            "state": row.data["state"] if recoverable or self.alive(row.data["expires"]) else "expired",
            "expires_at": row.data["expires"],
            "company_name": company.data["name"],
            "company_origin": self.public_origin(company),
            "policy": self.policy(company),
            "deletion_public_key": self.analytics.public_key(),
            "poll_interval_seconds": 5,
        }

    def connection_company(self, s, ctx):
        # At the shared address an unknown connection id names no organization; answer as a host does.
        if not (ctx["tenant_origin"] if "tenant_origin" in ctx else ctx["origin"]):
            raise Problem("connection_denied", 403)
        return self.tenant_of(s, ctx)

    def connection_proof(self, s, company, data, require_live=True):
        row = get(s, "connection", data["connection_id"], company.id)
        if not row or not hmac.compare_digest(row.data["challenge"], digest(data["verifier"])):
            raise Problem("connection_denied", 403)
        if require_live and not self.alive(row.data["expires"]):
            raise Problem("connection_expired", 410)
        return row

    def credentials(self, s, company, member, device, family_id=None):
        access, refresh = token(), token()
        family_id = family_id or uid()
        put(s, "family", family_id, {"revoked": False, "device": device.id}, company.id, member.id)
        put(
            s,
            "access",
            digest(access),
            {"expires": self.expires(600), "family": family_id, "device": device.id},
            company.id,
            member.id,
        )
        put(
            s,
            "refresh",
            digest(refresh),
            {"expires": self.expires(REFRESH_SECONDS), "family": family_id, "device": device.id, "used": False},
            company.id,
            member.id,
        )
        return {
            "access_token": access,
            "refresh_token": refresh,
            "access_expires_at": self.expires(600),
            "refresh_expires_at": self.expires(REFRESH_SECONDS),
        }

    def exchange(self, s, ctx, body):
        self.require_origin(ctx, True)
        data = dto.ConnectionExchange.model_validate_json(canonical(body)).model_dump(mode="json")
        company = self.connection_company(s, ctx)
        row = self.connection_proof(s, company, data, False)
        if row.data["state"] == "consumed":
            device = get(s, "device", row.data["device"], company.id)
            if (
                row.data["exchange"] != data["exchange_id"]
                or not self.alive(row.data["cache_expires"])
                or not device
                or device.data["status"] != "active"
            ):
                raise Problem("connection_denied", 403)
            result = self.secrets.decrypt(row.data["cache"])
            old = get(s, "refresh", digest(result["refresh_token"]), company.id)
            family = get(s, "family", old.data["family"], company.id) if old else None
            if not family or family.data["revoked"]:
                raise Problem("connection_denied", 403)
            return result
        if not self.alive(row.data["expires"]):
            raise Problem("connection_expired", 410)
        if row.data["state"] != "verified":
            raise Problem("connection_denied", 409)
        # The member confirms in the extension what is shared under the policy it was shown.
        save_policy(self, s, company)
        if data["policy_version"] != company.data["policy_version"]:
            raise Problem("policy_changed", 409)
        member = get(s, "member", row.owner, company.id)
        if not member or member.data["status"] != "active":
            raise Problem("connection_denied", 403)
        row.data = {**row.data, "state": "approved", "policy": data["policy_version"]}
        reconnect, deletion_receipt = token(), token()
        if row.data["resume"]:
            device = get(s, "device", row.data["resume"], company.id)
            if not device or device.owner != member.id or device.data["status"] in {"revoked", "deleted"}:
                raise Problem("connection_denied", 403)
            self.revoke_families(s, company.id, device.id)
            device.data = {
                **device.data,
                "status": "active",
                "reconnect": digest(reconnect),
                "last_seen_at": instant(self.now()),
            }
        else:
            device = put(
                s,
                "device",
                uid(),
                {
                    "browser_family": row.data["browser"],
                    "status": "active",
                    "reconnect": digest(reconnect),
                    "created_at": instant(self.now()),
                    "last_reporting_at": None,
                    "last_seen_at": instant(self.now()),
                },
                company.id,
                member.id,
            )
        from .db import EnrollmentEra

        for earlier in s.scalars(
            select(EnrollmentEra).where(
                EnrollmentEra.tenant == company.id,
                EnrollmentEra.device_id == device.id,
                EnrollmentEra.ended_at.is_(None),
            )
        ):
            earlier.data = {**earlier.data, "end": instant(self.now())}
        era = put(
            s,
            "era",
            uid(),
            {
                "device": device.id,
                "start": instant(self.now()),
                "end": None,
                "policy_version": company.data["policy_version"],
            },
            company.id,
            member.id,
        )
        acknowledge(self, s, company, device, company.data["policy_version"])
        put(
            s,
            "deletion_receipt",
            device.id,
            {"hash": digest(deletion_receipt), "ack_epoch": 0},
            company.id,
            member.id,
        )
        result = {
            **self.credentials(s, company, member, device),
            "company_id": company.id,
            "user_id": member.id,
            "device_id": device.id,
            "installation_reconnect_secret": reconnect,
            "deletion_receipt_credential": deletion_receipt,
            "method_public_key": self.settings.method_public_key or None,
            "key_version": "1",
            "user_hmac_key": self.secrets.decrypt(member.data["hmac_key"]),
            # One key for every member, so their browsers name a shared reply alike (W11).
            "company_dedup_key": browser_key(self, company),
            "policy": self.policy(company),
            "enrollment_era": {"id": era.id, **era.data},
            "company_name": company.data["name"],
        }
        row.data = {
            **row.data,
            "state": "consumed",
            "device": device.id,
            "exchange": data["exchange_id"],
            "cache": self.secrets.encrypt(result),
            "cache_expires": self.expires(86400),
        }
        return result

    def revoke_families(self, s, tenant, device):
        refresh_cls = TABLES["refresh"]
        horizon = self.expires(REPLACED_REFRESH_SECONDS)
        for family in rows(s, "family", tenant):
            if family.data["device"] == device:
                family.data = {**family.data, "revoked": True}
        # A revoked token keeps answering enrollment_revoked, so the extension disconnects cleanly,
        # for as long as a replaced one is kept; maintenance then deletes it instead of keeping its
        # hash for up to ten years.
        for row in s.scalars(
            select(refresh_cls).where(refresh_cls.tenant == tenant, refresh_cls.device_id == device)
        ):
            if row.data["expires"] > horizon:
                row.data = {**row.data, "expires": horizon}

    def revoke_device(self, s, company, device):
        """Signs one browser out at once: its tokens stop working and it must connect again."""
        device.data = {**device.data, "status": "revoked", "reconnect": ""}
        self.revoke_families(s, company.id, device.id)
        for era in rows(s, "era", company.id, device.owner):
            if era.data["device"] == device.id and era.data["end"] is None:
                era.data = {**era.data, "end": instant(self.now())}

    def refresh(self, s, ctx, body):
        self.require_origin(ctx, True)
        data = dto.Refresh.model_validate_json(canonical(body)).model_dump(mode="json")
        company = self.tenant_of(s, ctx)
        row = get(s, "refresh", digest(data["refresh_token"]), company.id)
        if not row or not self.alive(row.data["expires"]):
            raise Problem("authentication_required", 401)
        family = get(s, "family", row.data["family"], company.id)
        device, member = (
            get(s, "device", row.data["device"], company.id),
            get(s, "member", row.owner, company.id),
        )
        if (
            not family
            or family.data["revoked"]
            or not device
            or device.data["status"] != "active"
            or not member
            or member.data["status"] != "active"
        ):
            raise Problem("enrollment_revoked", 403)
        if row.data["used"]:
            if row.data["operation"] == data["operation_id"] and self.alive(row.data["cache_expires"]):
                return self.secrets.decrypt(row.data["cache"])
            family.data = {**family.data, "revoked": True}
            return {"_error": "refresh_reuse_detected", "_status": 403}
        # Shown to administrators with the browser's first connection; never with an IP address.
        device.data = {**device.data, "last_seen_at": instant(self.now())}
        result = {
            **self.credentials(s, company, member, device, family.id),
            # Installations enrolled before company keys existed receive it here (W11).
            "company_dedup_key": browser_key(self, company),
        }
        row.data = {
            **row.data,
            "used": True,
            # A replaced token stays 30 days so a replay of it still revokes the family, then goes.
            "expires": self.expires(REPLACED_REFRESH_SECONDS),
            "operation": data["operation_id"],
            "cache": self.secrets.encrypt(result),
            "cache_expires": self.expires(120),
        }
        return result

    def bootstrap(self, s, ctx, path, body, query):
        if path == "/auth/bootstrap/start":
            company = self.tenant_of(s, ctx)
            registration = get(s, "registration", query.get("registration_id"))
            if not registration or registration.data.get("company") != company.id:
                raise Problem("bootstrap_denied", 403)
            for prior in rows(s, "bootstrap", company.id, registration.data["user"]):
                prior.data = {**prior.data, "used": True}
                if prior.data.get("session"):
                    old = get(s, "session", prior.data["session"])
                    if old:
                        s.delete(old)
            nonce, state = token(), uid()
            put(
                s,
                "bootstrap",
                state,
                {
                    "registration": registration.id,
                    "nonce": digest(nonce),
                    "origin": company.data["origin"],
                    "expires": self.expires(300),
                    "used": False,
                },
                company.id,
                registration.data["user"],
            )
            return {
                "_bootstrap_cookie": nonce,
                "_redirect": self.settings.registration_origin + "/auth/bootstrap/authorize?state=" + state,
            }
        if path == "/auth/bootstrap/authorize":
            if ctx["origin"] != self.settings.registration_origin:
                raise Problem("bootstrap_denied", 403)
            session = get(s, "session", digest(ctx.get("registration_cookie", "")))
            row = get(s, "bootstrap", query.get("state"))
            if (
                not session
                or session.data["purpose"] != "registration"
                or not self.alive(session.data["expires"])
                or not row
                or row.data["used"]
                or not self.alive(row.data["expires"])
                or session.data["registration"] != row.data["registration"]
                or session.owner != row.owner
            ):
                raise Problem("bootstrap_denied", 403)
            grant = token()
            row.data = {**row.data, "grant": digest(grant), "grant_expires": self.expires(60)}
            fields = {"registration_id": row.data["registration"], "state": row.id, "bootstrap_grant": grant}
            form = (
                '<!doctype html><html><head><title>Continue to your company</title></head><body><form method="post" action="'
                + html.escape(row.data["origin"] + "/v1/auth/bootstrap/exchange", quote=True)
                + '">'
            )
            for name, value in fields.items():
                form += (
                    '<input type="hidden" name="' + name + '" value="' + html.escape(value, quote=True) + '">'
                )
            form += '<button type="submit">Continue to company</button></form></body></html>'
            return {"_html": form, "_form_origin": row.data["origin"]}
        company = self.tenant_of(s, ctx)
        row = get(s, "bootstrap", body["state"], company.id)
        if (
            ctx.get("request_origin") != self.settings.registration_origin
            or not row
            or row.data["used"]
            or not self.alive(row.data.get("grant_expires"))
            or body["registration_id"] != row.data["registration"]
            or not hmac.compare_digest(row.data["nonce"], digest(ctx.get("bootstrap_cookie", "")))
            or not hmac.compare_digest(row.data.get("grant", ""), digest(body["bootstrap_grant"]))
        ):
            raise Problem("bootstrap_denied", 403)
        member = get(s, "member", row.owner, company.id)
        if not member or member.data["status"] != "active" or member.data["role"] != "admin":
            raise Problem("bootstrap_denied", 403)
        raw, csrf = self.session(s, company, member)
        row.data = {**row.data, "used": True, "grant": "", "session": digest(raw)}
        return {"_cookie": raw, "_redirect": "/admin", "_clear_bootstrap": True}

    def handle(self, s, ctx, path, body, query):
        method = ctx["method"]
        if path.startswith("/auth/bootstrap/") or path == "/v1/auth/bootstrap/exchange":
            return self.bootstrap(s, ctx, path, body, query)
        if path == "/v1/public/deployment" and method == "GET":
            if ctx["origin"] != self.settings.registration_origin or ctx.get("request_origin") not in {
                None,
                ctx["origin"],
            }:
                raise Problem("origin_forbidden", 403)
            if query:
                raise Problem("unsupported_filter", 422)
            return {
                "mode": self.settings.mode,
                "hosted_domain": self.settings.hosted_domain if self.settings.mode == "hosted" else None,
                "registration_origin": self.settings.registration_origin,
            }
        if path == "/v1/public/contact" and method == "POST":
            return self.contact(s, ctx, body)
        if path == "/v1/public/config" and method == "GET":
            company = self.tenant_of(s, ctx)
            save_policy(self, s, company)
            return {
                "company_name": company.data["name"],
                "company_origin": self.public_origin(company),
                "auth_protocol": "email_otp",
                "connection_protocol_version": "1.0.0",
                "policy": self.policy(company),
                "deletion_public_key": self.analytics.public_key(),
                "deletion_key_version": "1",
                "disclosure": "All supported use in this enrolled browser profile is shared with your company. Numerical observations and connection IPs are collected. Chat content is not uploaded.",
            }
        if path == "/v1/organizations/registrations" and method == "POST":
            return self.registration(s, ctx, body)
        operator_auth = path.startswith("/v1/operator/auth/")
        if path in {"/v1/auth/otp/request", "/v1/operator/auth/otp/request"} and method == "POST":
            return self.request_otp(s, ctx, body, operator_auth)
        if path in {"/v1/auth/otp/verify", "/v1/operator/auth/otp/verify"} and method == "POST":
            return self.verify_otp(s, ctx, body, operator_auth)
        if path == "/v1/connections/otp/request" and method == "POST":
            return self.connection_otp(s, ctx, body)
        if path == "/v1/auth/otp/resend" and method == "POST":
            data = dto.OTPResend.model_validate_json(canonical(body)).model_dump(mode="json")
            old = get(s, "otp", data["challenge_id"])
            # The extension may resend its own connection code; every other code is the website's.
            self.require_origin(ctx, bool(old) and old.data["purpose"] == "connect")
            operation_key = digest(ctx["origin"] + ":" + data["challenge_id"] + ":" + data["dispatch_id"])
            prior = get(s, "resend_operation", operation_key)
            if prior:
                replacement = get(s, "otp", prior.data["challenge_id"])
                if not replacement or not self.alive(replacement.data["expires"]):
                    raise Problem("otp_invalid_or_expired", 401)
                return self.challenge_result(replacement)
            if (
                not old
                or old.data["origin"] != ctx["origin"]
                or old.data["consumed"]
                or not self.alive(old.data["expires"])
            ):
                raise Problem("otp_invalid_or_expired", 401)
            resend_at = parse_time(old.data["issued"]) + timedelta(seconds=60)
            if resend_at > self.now():
                wait = math.ceil((resend_at - self.now()).total_seconds())
                raise Problem("otp_rate_limited", 429, True, retry_after=max(1, wait))
            if old.data["purpose"] == "connect":
                result = self.connection_otp(
                    s,
                    ctx,
                    {"dispatch_id": data["dispatch_id"], "email": self.secrets.decrypt(old.data["email"])},
                )
            else:
                result = self.request_otp(
                    s,
                    ctx,
                    {
                        "purpose": old.data["purpose"],
                        "dispatch_id": data["dispatch_id"],
                        "email": self.secrets.decrypt(old.data["email"]),
                        "registration_id": old.data["registration"],
                    },
                    # A developer code is resent through the developer rules and address.
                    old.data["purpose"] in OPERATOR_PURPOSES,
                )
            old.data = {**old.data, "consumed": True, "mac": "", "email": ""}
            put(s, "resend_operation", operation_key, {"challenge_id": result["challenge_id"]})
            return result
        if path in {"/v1/auth/session", "/v1/operator/auth/session"}:
            company, member, _ = self.principal(s, ctx, operator=operator_auth, web_only=True, grace=True)
            if method == "DELETE":
                s.delete(ctx["session"])
                return {"logged_out": True, "_clear_operator" if operator_auth else "_clear_cookie": True}
            if method == "GET":
                csrf = self.secrets.decrypt(ctx["session"].data["csrf_secret"])
                # The signed-in person's own work email, shown beside Sign out.
                identity = (
                    s.scalar(
                        select(EmailIdentity).where(
                            EmailIdentity.tenant == member.tenant, EmailIdentity.owner == member.id
                        )
                    )
                    if member
                    else None
                )
                return {
                    "email": self.secrets.decrypt(identity.data["email"])
                    if identity and identity.data.get("email")
                    else self.operator_emails().get(ctx["session"].owner)
                    if operator_auth
                    else None,
                    "role": member.data["role"] if member else "operator",
                    "user_id": member.id if member else None,
                    "company_id": company.id if company else None,
                    "company_name": company.data["name"] if company else None,
                    # "deletion_scheduled" tells the dashboard to offer only the cancellation.
                    "organization_status": company.data["status"] if company else None,
                    "csrf_token": csrf,
                    "expires_at": ctx["session"].data["expires"],
                }
        if path == "/v1/organizations/registration-status" and method == "GET":
            session = get(s, "session", digest(ctx.get("registration_cookie", "")))
            if (
                ctx["origin"] != self.settings.registration_origin
                or not session
                or session.data["purpose"] != "registration"
                or not self.alive(session.data["expires"])
            ):
                raise Problem("authentication_required", 401)
            row = get(s, "registration", session.data["registration"])
            company = get(s, "company", row.data["company"])
            return {**self.registration_result(row), "company_origin": self.public_origin(company)}
        if path == "/v1/organizations/provisioning/retry" and method == "POST":
            self.require_origin(ctx)
            dto.ProvisionRetry.model_validate_json(canonical(body))
            session = get(s, "session", digest(ctx.get("registration_cookie", "")))
            if (
                ctx["origin"] != self.settings.registration_origin
                or not session
                or session.data["purpose"] != "registration"
                or not self.alive(session.data["expires"])
                or not hmac.compare_digest(session.data["csrf"], digest(ctx.get("csrf", "")))
            ):
                raise Problem("authentication_required", 401)
            row = get(s, "registration", session.data["registration"])
            company = get(s, "company", row.data["company"])
            if not self.settings.routing_verified:
                raise Problem("provisioning_failed", 503, True)
            company.data = {**company.data, "status": "active"}
            row.data = {**row.data, "state": "active"}
            return {"registration_id": row.id, "state": "active", "company_origin": self.public_origin(company)}
        if path == "/v1/connections" and method == "POST":
            return self.connection_create(s, ctx, body)
        if path == "/v1/connections/exchange" and method == "POST":
            return self.exchange(s, ctx, body)
        if path == "/v1/auth/refresh" and method == "POST":
            return self.refresh(s, ctx, body)
        if path in {"/v1/connections/status", "/v1/connections/cancel"} and method == "POST":
            self.require_origin(ctx, True)
            data = dto.ConnectionProof.model_validate_json(canonical(body)).model_dump(mode="json")
            company = self.connection_company(s, ctx)
            row = self.connection_proof(s, company, data, False)
            if path.endswith("cancel"):
                if row.data["state"] == "consumed":
                    raise Problem("connection_consumed", 409)
                row.data = {**row.data, "state": "cancelled"}
            elif row.data["last_poll"] and parse_time(row.data["last_poll"]) > self.now() - timedelta(
                seconds=5
            ):
                raise Problem("poll_too_frequent", 429, True)
            row.data = {**row.data, "last_poll": instant(self.now())}
            return self.connection_result(row, company)
        if path == "/v1/connections/disconnect" and method == "POST":
            if set(body) - {"operation_id"}:
                raise Problem("invalid_payload", 422)
            company = self.tenant_of(s, ctx)
            operation = None
            if body.get("operation_id"):
                from uuid import UUID

                try:
                    UUID(body["operation_id"])
                except (ValueError, TypeError):
                    raise Problem("invalid_payload", 422) from None
                operation = digest(
                    company.id + ":" + digest(ctx.get("bearer") or "") + ":" + body["operation_id"]
                )
                cached = get(s, "disconnect_operation", operation, company.id)
                if cached and self.alive(cached.data["expires"]):
                    return cached.data["result"]
            previous = get(s, "access", digest(ctx.get("bearer") or ""), company.id)
            prior_device = get(s, "device", previous.data["device"], company.id) if previous else None
            if (
                prior_device
                and prior_device.data["status"] == "disconnected"
                and self.alive(previous.data["expires"])
            ):
                return {"disconnected": True}
            company, member, device = self.principal(s, ctx)
            if not device:
                raise Problem("installation_required", 403)
            device.data = {**device.data, "status": "disconnected"}
            self.revoke_families(s, company.id, device.id)
            for era in rows(s, "era", company.id, member.id):
                if era.data["device"] == device.id and era.data["end"] is None:
                    era.data = {**era.data, "end": instant(self.now())}
            result = {"disconnected": True}
            if operation:
                result.update(operation_id=body["operation_id"], disconnected_at=instant(self.now()))
                put(
                    s,
                    "disconnect_operation",
                    operation,
                    {"result": result, "expires": self.expires(86400)},
                    company.id,
                    member.id,
                )
            return result
        if path.startswith("/v1/operator/"):
            if method != "GET" and body.get("idempotency_key"):
                self.principal(s, ctx, operator=True, web_only=True)
                operation = digest(
                    canonical([ctx["origin"], ctx["session"].owner, path, str(body["idempotency_key"])])
                )
                prior = get(s, "entitlement_operation", operation)
                # The single-use code is left out, so a retry of an action that already happened
                # replays its answer whichever code it carries. Only this developer's action replays.
                request_hash = digest(canonical({k: v for k, v in body.items() if k != "reauth_token"}))
                if prior:
                    if prior.data["hash"] != request_hash:
                        raise Problem("idempotency_conflict", 409)
                    return prior.data["result"]
                result = self.operator(s, ctx, path, body, query)
                put(s, "entitlement_operation", operation, {"hash": request_hash, "result": result})
                return result
            return self.operator(s, ctx, path, body, query)
        if path in {"/v1/deletions/status", "/v1/deletions/ack"} and method == "POST":
            self.require_origin(ctx, True)
            return self.analytics.receipt(s, ctx, body, path.endswith("/ack"))
        if path == "/v1/admin/organization/deletion":
            from .organization_deletion import handle

            return handle(self, s, ctx, method, body)
        company, member, device = self.principal(s, ctx, admin=path.startswith("/v1/admin/"))
        if path == "/v1/config" and method == "GET":
            save_policy(self, s, company)
            if device and device.data.get("offered_policy") != company.data["policy_version"]:
                device.data = {
                    **device.data,
                    "offered_policy": company.data["policy_version"],
                    "policy_offered_at": instant(self.now()),
                }
            return {
                **self.policy(company),
                "policy": self.policy(company),
                "features": self.features(),
                "server_time": instant(self.now()),
            }
        if path == "/v1/config/acknowledge" and method == "POST":
            if set(body) != {"policy_version"} or not isinstance(body["policy_version"], str):
                raise Problem("invalid_payload", 422)
            if not device:
                raise Problem("installation_required", 403)
            return acknowledge(
                self,
                s,
                company,
                device,
                body["policy_version"],
                device.data.get("policy_offered_at")
                if device.data.get("offered_policy") == body["policy_version"]
                else None,
            )
        if path == "/v1/me/devices" and method == "GET":
            return {
                "items": [
                    {
                        "device_id": d.id,
                        "browser_family": d.data["browser_family"],
                        "status": d.data["status"],
                        "last_reporting_at": d.data["last_reporting_at"],
                    }
                    for d in rows(s, "device", company.id, member.id)
                ]
            }
        if path.startswith("/v1/me/devices/") and method == "DELETE":
            company, member, _ = self.principal(s, ctx, web_only=True)
            data = dto.DeviceRevoke.model_validate_json(canonical(body)).model_dump(mode="json")
            self.reauth(s, company, member, data["reauth_token"])
            target = get(s, "device", path.rsplit("/", 1)[-1], company.id)
            if not target or target.owner != member.id:
                raise Problem("not_found", 404)
            self.revoke_device(s, company, target)
            return {"revoked": True}
        if path.startswith("/v1/admin/users/") and path.endswith("/role") and method == "PUT":
            return self.role_change(s, ctx, company, member, path.split("/")[-2], body)
        if re.fullmatch(r"/v1/admin/users/[^/]+/devices", path) and method == "GET":
            return self.member_devices(s, company, path.split("/")[4])
        if re.fullmatch(r"/v1/admin/users/[^/]+/devices/[^/]+/revoke", path) and method == "POST":
            parts = path.split("/")
            return self.admin_revoke_device(s, company, member, parts[4], parts[6], body)
        if re.fullmatch(r"/v1/admin/users/[^/]+/status", path) and method == "PUT":
            return self.member_status(s, company, member, path.split("/")[4], body)
        if path == "/v1/admin/users" and method == "GET":
            if set(query) - {"cursor", "limit", "role", "status"}:
                raise Problem("unsupported_filter", 422)
            _, limit = self.pagination({"limit": query.get("limit", 50)})
            cursor = query.get("cursor", "")
            if cursor:
                from uuid import UUID

                try:
                    UUID(cursor)
                except ValueError:
                    raise Problem("invalid_pagination", 422) from None
            statement = (
                select(Member, EmailIdentity)
                .outerjoin(
                    EmailIdentity,
                    (EmailIdentity.tenant == Member.tenant) & (EmailIdentity.owner == Member.id),
                )
                .where(Member.tenant == company.id, Member.id > cursor)
            )
            for name, values in (("role", {"user", "admin"}), ("status", {"active", "deleted", "suspended"})):
                if query.get(name):
                    if query[name] not in values:
                        raise Problem("unsupported_filter", 422)
                    statement = statement.where(getattr(Member, name) == query[name])
            users = list(s.execute(statement.order_by(Member.id).limit(limit + 1)))
            counts = dict(
                s.execute(
                    select(Device.owner, func.count())
                    .where(
                        Device.tenant == company.id, Device.owner.in_([user.id for user, _ in users[:limit]])
                    )
                    .group_by(Device.owner)
                ).all()
            )
            result = []
            for user, email in users[:limit]:
                result.append(
                    {
                        "user_id": user.id,
                        "email": self.secrets.decrypt(email.data["email"])
                        if email and email.data["email"]
                        else None,
                        "role": user.data["role"],
                        "status": user.data["status"],
                        "membership_version": user.data["version"],
                        "installations": counts.get(user.id, 0),
                    }
                )
            return {
                "items": result,
                "next_cursor": users[limit - 1][0].id if len(users) > limit else None,
            }
        if path == "/v1/admin/audit" and method == "GET":
            return self.analytics.admin_queries.audit(s, company, query)
        if path == "/v1/admin/plan" and method == "GET":
            return {
                "plan_id": company.data["plan_id"],
                "plan_version": company.data["plan_version"],
                "version": company.data["version"],
                "member_capacity": company.data["capacity"],
                "usage_retention_months": company.data["retention_months"],
                "mode": self.settings.mode,
                "billing_status": "not_configured",
                "entitlement_generation": company.data.get("entitlement_generation", 0),
                "transitions": [
                    self.transition_result(company, t) for t in rows(s, "transition", company.id)
                ],
            }
        if path == "/v1/admin/policy" and method == "PUT":
            data = dto.PolicyUpdate.model_validate_json(canonical(body)).model_dump(mode="json")
            operation, request_hash, prior = self.admin_operation(s, company, member, "policy", data)
            if prior:
                return prior
            if data["expected_version"] != company.data["policy_version"]:
                raise Problem("stale_version", 409)
            try:
                ZoneInfo(data["timezone"])
            except ZoneInfoNotFoundError:
                raise Problem("invalid_timezone", 422) from None
            choice = company.data.get("retention_choice")
            if data["usage_retention"] is not None:
                choice = None if data["usage_retention"] == "until_deleted" else int(data["usage_retention"])
                plan = company.data["retention_months"]
                if plan is not None and (choice is None or choice > plan):
                    raise Problem("retention_above_plan", 422)
            # Administrator sessions last 7 days, so a policy change needs a fresh email code. A
            # shorter usage retention deletes older usage for good, and sharing exposes totals.
            self.reauth(s, company, member, data["reauth_token"])
            old = company.data["policy_version"].split(".")
            save_policy(self, s, company)
            rebucket = data["timezone"] != company.data["timezone"]
            company.data = {
                **company.data,
                "timezone": data["timezone"],
                "pause_mode": data["pause_mode"],
                "company_sharing": data["company_sharing"],
                "retention_choice": choice,
                "policy_version": f"{old[0]}.{old[1]}.{int(old[2]) + 1}",
                "aggregate_status": "rebuilding"
                if rebucket
                else company.data.get("aggregate_status", "current"),
            }
            self.audit(s, company.id, member.id, "policy_changed", company.id)
            save_policy(self, s, company)
            return self.remember_operation(s, company, member, operation, request_hash, self.policy(company))
        if path == "/v1/health/reports" and method == "POST":
            data = dto.HealthReport.model_validate_json(canonical(body)).model_dump(mode="json")
            if not device:
                raise Problem("installation_required", 403)
            put(s, "health", device.id, {**data, "at": instant(self.now())}, company.id, member.id)
            return {"received": True}
        if path == "/v1/admin/health" and method == "GET":
            if not self.settings.person_analytics_enabled:
                self.refuse_person_filter(query)
                if query:
                    raise Problem("unsupported_filter", 422)
                return self.health_counts(s, company)
            # Reports and upload times from before the first full day after person analytics was
            # switched on stay hidden, as in every other per-person view (Analytics.person_floor).
            since = self.analytics.person_floor(s, company)[0]
            reports = {
                r.id: r.data for r in rows(s, "health", company.id) if self.recorded_since(r.data.get("at"), since)
            }
            # Each connected browser with its last upload and last health report, at most 1000.
            browsers = [
                {
                    "device_id": d.id,
                    "user_id": d.owner,
                    "browser_family": d.data["browser_family"],
                    "last_reporting_at": self.recorded_since(d.data["last_reporting_at"], since),
                    "connected_at": d.data["created_at"],
                    "client_version": (reports.get(d.id) or {}).get("client_version"),
                    "report": reports.get(d.id),
                }
                for d in s.scalars(
                    select(Device)
                    .where(Device.tenant == company.id, Device.status == "active")
                    .limit(1000)
                )
            ]
            # The counts come too, so the Overview reads one shape in both settings.
            return {**self.health_counts(s, company), "items": list(reports.values()), "browsers": browsers}
        if hasattr(self, "analytics"):
            return self.analytics(s, ctx, path, body, query, company, member, device)
        raise Problem("not_found", 404)

    def pagination(self, query):
        try:
            limit, offset = int(query.get("limit", 50)), int(query.get("cursor", 0))
            if not 1 <= limit <= 200 or offset < 0:
                raise ValueError
            return offset, limit
        except ValueError:
            raise Problem("invalid_pagination", 422) from None

    # A connected browser that has not uploaded for this long (or, if it never uploaded, has been
    # connected this long) counts as not synced on the Health page.
    STALE_SYNC = timedelta(days=3)
    HEALTH_PROBLEMS = ("capture_failed", "storage_failed", "sync_failed", "tokenizer_failed", "calculation_failed")

    def health_counts(self, s, company):
        """
        The organization's sync health as counts only, while person analytics is off (owner decision
        of 18 October 2026): how many browsers are connected, how many synced recently or not for 3
        days, and how many reported each kind of failure. No browser, member or time of use is
        listed, so the page cannot be read as a record of when one person used AI.
        """
        reports = {r.id: r.data for r in rows(s, "health", company.id)}
        now = self.now()
        connected = synced_today = stale = 0
        problems = {}
        for device in s.scalars(
            select(Device).where(Device.tenant == company.id, Device.status == "active").limit(1000)
        ):
            connected += 1
            last = device.data.get("last_reporting_at")
            if last and parse_time(last) > now - timedelta(days=1):
                synced_today += 1
            # A browser that never synced is measured from its connection, so one connected minutes
            # ago is not counted as three days late.
            if parse_time(last or device.data["created_at"]) <= now - self.STALE_SYNC:
                stale += 1
            report = reports.get(device.id)
            if report and report.get("code") in self.HEALTH_PROBLEMS:
                key = (report["code"], report.get("site"))
                problems[key] = problems.get(key, 0) + 1
        return {
            "browsers_connected": connected,
            "browsers_synced_last_day": synced_today,
            "browsers_not_synced_3_days": stale,
            "problems": [
                {"code": code, "site": site, "browsers": count}
                for (code, site), count in sorted(problems.items(), key=lambda kv: (kv[0][0], kv[0][1] or ""))
            ],
        }

    @staticmethod
    def recorded_since(value, since):
        """A time of use, or None when it falls before since (see Analytics.person_floor)."""
        return value if value and since and parse_time(value) >= parse_time(since) else None

    def member_devices(self, s, company, user_id):
        """
        A member's browsers for administrators, for managing access: which browsers are connected
        and since when, never IP addresses. The last-seen time shows when the person used AI, so it
        is sent only while person analytics is on, and only when it falls after the switch
        (Analytics.person_floor).
        """
        if not get(s, "member", user_id, company.id):
            raise Problem("not_found", 404)
        since = self.analytics.person_floor(s, company)[0] if self.settings.person_analytics_enabled else None
        devices = s.scalars(
            select(Device).where(Device.tenant == company.id, Device.owner == user_id).order_by(Device.id)
        )
        items = []
        for device in devices:
            item = {
                "device_id": device.id,
                "browser_family": device.data["browser_family"],
                "status": device.data["status"],
                "first_seen_at": device.data["created_at"],
            }
            if since:
                seen = [t for t in (device.data.get("last_seen_at"), device.data.get("last_reporting_at")) if t]
                item["last_seen_at"] = self.recorded_since(max(seen), since) if seen else None
            items.append(item)
        items.sort(key=lambda item: (item["status"] != "active", item["first_seen_at"]))
        return {"items": items}

    def admin_revoke_device(self, s, company, actor, user_id, device_id, body):
        """An administrator removes one browser; the member keeps their data and may connect again."""
        data = dto.AdminDeviceRevoke.model_validate_json(canonical(body)).model_dump(mode="json")
        device = get(s, "device", device_id, company.id)
        if not device or device.owner != user_id:
            raise Problem("not_found", 404)
        self.reauth(s, company, actor, data["reauth_token"])
        if device.data["status"] in {"active", "disconnected"}:
            self.revoke_device(s, company, device)
            self.audit(s, company.id, actor.id, "browser_removed", device.id, {"user_id": user_id})
        return {"device_id": device.id, "status": device.data["status"]}

    def member_status(self, s, company, actor, user_id, body):
        """
        Suspends a member (no connecting, no syncing, data kept) or reactivates one. The member's
        browsers get enrollment_revoked at their next call and disconnect; after reactivation the
        person connects again with an email code.
        """
        data = dto.MemberStatus.model_validate_json(canonical(body)).model_dump(mode="json")
        target = get(s, "member", user_id, company.id)
        if not target or target.data["status"] not in {"active", "suspended"}:
            raise Problem("not_found", 404)
        if target.id == actor.id:
            raise Problem("self_action", 409)
        if target.data["version"] != data["expected_version"]:
            raise Problem("stale_version", 409)
        if data["status"] != target.data["status"]:
            active = select(func.count()).select_from(Member).where(
                Member.tenant == company.id, Member.status == "active"
            )
            if (
                data["status"] == "suspended"
                and target.data["role"] == "admin"
                and s.scalar(active.where(Member.role == "admin")) <= 1
            ):
                raise Problem("last_admin", 409)
            if data["status"] == "active" and s.scalar(active) >= company.data["capacity"]:
                raise Problem("capacity_reached", 409)
            self.reauth(s, company, actor, data["reauth_token"])
            target.data = {**target.data, "status": data["status"], "version": target.data["version"] + 1}
            if data["status"] == "suspended":
                for session in rows(s, "session", company.id, target.id):
                    s.delete(session)
                for device in rows(s, "device", company.id, target.id):
                    if device.data["status"] == "active":
                        self.revoke_families(s, company.id, device.id)
            self.audit(
                s,
                company.id,
                actor.id,
                "member_suspended" if data["status"] == "suspended" else "member_reactivated",
                target.id,
            )
        return {
            "user_id": target.id,
            "status": target.data["status"],
            "membership_version": target.data["version"],
        }

    def role_change(self, s, ctx, company, actor, target_id, body):
        data = dto.RoleChange.model_validate_json(canonical(body)).model_dump(mode="json")
        target = get(s, "member", target_id, company.id)
        operation = digest(company.id + ":" + actor.id + ":" + data["idempotency_key"])
        prior = get(s, "role_operation", operation, company.id)
        # The single-use code is left out, so a retry of a change that already happened replays its
        # answer whichever code it carries. Only this administrator's own operation can replay.
        request_hash = digest(
            canonical({**{k: v for k, v in data.items() if k != "reauth_token"}, "target": target_id})
        )
        if prior:
            if prior.data["hash"] != request_hash:
                raise Problem("idempotency_conflict", 409)
            return prior.data["result"]
        if not target or target.data["status"] != "active":
            raise Problem("not_found", 404)
        if target.data["version"] != data["expected_version"]:
            raise Problem("stale_version", 409)
        if (
            target.data["role"] == "admin"
            and data["role"] == "user"
            and s.scalar(
                select(func.count())
                .select_from(Member)
                .where(Member.tenant == company.id, Member.role == "admin", Member.status == "active")
            )
            <= 1
        ):
            raise Problem("last_admin", 409)
        # Review item S7: administrator sessions last 7 days, so a role change, like suspension,
        # needs a fresh email code and cannot be made from a session left open on another computer.
        self.reauth(s, company, actor, data["reauth_token"])
        target.data = {**target.data, "role": data["role"], "version": target.data["version"] + 1}
        for session in rows(s, "session", company.id, target.id):
            s.delete(session)
        result = {
            "user_id": target.id,
            "role": target.data["role"],
            "membership_version": target.data["version"],
        }
        put(s, "role_operation", operation, {"hash": request_hash, "result": result}, company.id, actor.id)
        self.audit(s, company.id, actor.id, "role_changed", target.id, {"role": data["role"]})
        return result

    def entitlement_snapshot(self, company):
        return {
            key: company.data[key]
            for key in ("plan_id", "plan_version", "capacity", "retention_months", "timezone")
        }

    def advance_entitlement(self, company):
        # Service availability has its own version changes. Only entitlement decisions invalidate a scheduled baseline.
        company.data = {
            **company.data,
            "version": company.data["version"] + 1,
            "entitlement_generation": company.data.get("entitlement_generation", 0) + 1,
        }

    def transition_state(self, transition):
        if transition.data.get("applied"):
            return "applied"
        return transition.data.get("status", "pending")

    def transition_valid(self, company, transition):
        return transition.data.get("base_generation") == company.data.get(
            "entitlement_generation", 0
        ) and transition.data.get("base_entitlement") == self.entitlement_snapshot(company)

    def transition_result(self, company, transition):
        from sqlalchemy.orm import object_session

        session = object_session(transition)
        plan = get(session, "plan", transition.data["plan"]) if session is not None else None
        target = (
            {
                "plan_id": plan.data["plan_id"],
                "plan_version": plan.data["version"],
                "capacity": plan.data["member_capacity"],
                "retention_months": plan.data["retention_months"],
                "timezone": company.data["timezone"],
            }
            if plan
            else None
        )
        state = self.transition_state(transition)
        valid = self.transition_valid(company, transition)
        if state == "pending" and (not valid or target is None):
            state = "review_required"
        return {
            **transition.data,
            "status": state,
            "current_entitlement": self.entitlement_snapshot(company),
            "target_entitlement": target,
            "acknowledgement_required": transition.data.get("retention_shortened") is not False,
            "current_entitlement_generation": company.data.get("entitlement_generation", 0),
            "company_version": company.data["version"],
            "operator_can_cancel": state in {"pending", "review_required"}
            and not transition.data.get("exception_id"),
            "operator_can_review": state == "review_required",
        }

    def entitlement_conflict(self, s, company, *, transition_id=None, exception_id=None):
        transition = TABLES["transition"]
        pending = select(transition.id).where(
            transition.tenant == company.id,
            func.coalesce(transition.data["applied"].as_boolean(), False).is_(False),
            func.coalesce(transition.data["status"].as_string(), "pending").not_in(
                ["cancelled", "superseded", "applied"]
            ),
        )
        if transition_id:
            pending = pending.where(transition.id != transition_id)
        exception = TABLES["exception"]
        active = select(exception.id).where(
            exception.tenant == company.id,
            exception.data["status"].as_string().in_(["active", "revocation_scheduled"]),
        )
        if exception_id:
            active = active.where(exception.id != exception_id)
        return s.scalar(pending.limit(1)) is not None or s.scalar(active.limit(1)) is not None

    def make_transition(self, s, company, plan, effective, reason, actor, **extra):
        identifier = uid()
        old, new = company.data["retention_months"], plan.data["retention_months"]
        return put(
            s,
            "transition",
            identifier,
            {
                "transition_id": identifier,
                "plan": plan.id,
                "target_plan_id": plan.data["plan_id"],
                "target_plan_version": plan.data["version"],
                "effective_at": instant(effective),
                "acknowledged": False,
                "applied": False,
                "status": "pending",
                "version": 1,
                "base_generation": company.data.get("entitlement_generation", 0),
                "base_entitlement": self.entitlement_snapshot(company),
                "retention_shortened": new is not None and (old is None or new < old),
                "retention_preview": retention_preview(self, s, company, new, effective),
                "reason": reason,
                "created_by": actor,
                "created_at": instant(self.now()),
                **extra,
            },
            company.id,
        )

    def contact(self, s, ctx, body):
        """A message from the website's Contact page. Only the main website may send one."""
        if self.settings.mode != "hosted" or ctx["origin"] != self.settings.registration_origin:
            raise Problem("origin_forbidden", 403)
        data = dto.ContactRequest.model_validate_json(canonical(body)).model_dump(mode="json")
        email = normalize_email(data["email"])
        key = digest(canonical(["contact", email, data["idempotency_key"]]))
        # A repeated send of the same form (a lost reply) is answered without a second message.
        if get(s, "contact", key):
            return {"received": True}
        # A filled hidden field marks an automated sender: answer as usual, keep nothing.
        if data["website"]:
            return {"received": True}
        self.rate(s, "contact:" + ctx["peer_key"], 5, 3600)
        self.rate(s, "contact:all", 200, 86400)
        now = instant(self.now())
        put(
            s,
            "contact",
            key,
            {
                "topic": data["topic"],
                "status": "new",
                "received_at": now,
                "updated_at": now,
                # Kept until the sender asks for deletion or the developer deletes it (owner decision, 11 Oct 2026).
                "sender": self.secrets.encrypt(
                    {
                        "name": data["name"],
                        "email": email,
                        "organization": data["organization"],
                        "people": data["people"],
                        "message": data["message"],
                    }
                ),
            },
        )
        return {"received": True}

    def contact_view(self, row):
        sender = self.secrets.decrypt(row.data["sender"])
        return {
            "id": row.id,
            "topic": row.data["topic"],
            "status": row.data["status"],
            "received_at": row.data["received_at"],
            "updated_at": row.data["updated_at"],
            **sender,
        }

    def operator(self, s, ctx, path, body, query):
        self.principal(s, ctx, operator=True, web_only=True)
        operator_actor = ctx["session"].owner

        def audit(tenant, action, target, details=None):
            self.audit(s, tenant, operator_actor, action, target, details, actor_kind="operator")

        if self.settings.mode != "hosted":
            raise Problem("not_applicable", 404)
        if path == "/v1/operator/diagnostics" and ctx["method"] == "GET":
            if set(query) - {"limit", "cursor", "correlation_id"}:
                raise Problem("unsupported_filter", 422)
            _, limit = self.pagination({"limit": query.get("limit", 50)})
            cls = TABLES["diagnostic"]
            statement = select(cls).where(cls.id > query.get("cursor", ""))
            if query.get("correlation_id"):
                statement = statement.where(cls.id == query["correlation_id"])
            records = list(s.scalars(statement.order_by(cls.id).limit(limit + 1)))
            return {
                "items": [row.data for row in records[:limit]],
                "next_cursor": records[limit - 1].id if len(records) > limit else None,
            }
        if path == "/v1/operator/contacts" and ctx["method"] == "GET":
            if set(query) - {"status"} or query.get("status", "all") not in {"all", "new", "replied", "closed"}:
                raise Problem("unsupported_filter", 422)
            wanted = query.get("status", "all")
            items = sorted(
                (self.contact_view(row) for row in rows(s, "contact")),
                key=lambda item: item["received_at"],
                reverse=True,
            )
            counts = {state: sum(1 for i in items if i["status"] == state) for state in ("new", "replied", "closed")}
            return {"items": [i for i in items if wanted == "all" or i["status"] == wanted][:500], "counts": counts}
        if path.startswith("/v1/operator/contacts/") and ctx["method"] in {"POST", "DELETE"}:
            key = path.removeprefix("/v1/operator/contacts/")
            row = get(s, "contact", key) if re.fullmatch(r"[0-9a-f]{64}", key) else None
            if not row:
                raise Problem("not_found", 404)
            if ctx["method"] == "DELETE":
                data = dto.ContactDelete.model_validate_json(canonical(body)).model_dump(mode="json")
                self.operator_reauth(s, ctx, data["reauth_token"])
                s.delete(row)
                s.flush()
                audit("", "contact_request_deleted", key)
                return {"deleted": True}
            data = dto.ContactStatus.model_validate_json(canonical(body)).model_dump(mode="json")
            row.data = {**row.data, "status": data["status"], "updated_at": instant(self.now())}
            audit("", "contact_request_status", key, {"status": data["status"]})
            return self.contact_view(row)
        if path == "/v1/operator/domain-claims" and ctx["method"] == "POST":
            data = dto.DomainClaimApproval.model_validate_json(canonical(body)).model_dump(mode="json")
            domain = normalize_domain(data["domain"])
            if is_free_mail(domain) or parse_time(data["expires_at"]) <= self.now():
                raise Problem("invalid_domain_approval", 422)
            key = self.domain_claim_key(domain)
            prior = get(s, "domain_claim", key)
            # One record per domain: a consumed exception admits nobody else, and a further
            # organization on the domain needs a new approval of the current version.
            if data["expected_version"] != (prior.data["version"] if prior else 0):
                raise Problem("stale_version", 409)
            # The approval lets a further organization register on a domain another one uses.
            self.operator_reauth(s, ctx, data["reauth_token"])
            record = {
                "approval_id": key,
                "domain": domain,
                "version": data["expected_version"] + 1,
                "reason": data["reason"],
                "reviewer_id": ctx["session"].owner,
                "reviewed_at": instant(self.now()),
                "expires_at": instant(parse_time(data["expires_at"])),
                "status": "approved",
            }
            put(s, "domain_claim", key, record)
            audit("", "domain_exception_approved", key, record)
            return record
        if path == "/v1/operator/domain-claims" and ctx["method"] == "GET":
            _, limit = self.pagination({"limit": query.get("limit", 50)})
            from .db import page

            records = page(s, "domain_claim", after=query.get("cursor", ""), limit=limit + 1)
            return {
                "items": [r.data for r in records[:limit]],
                "next_cursor": records[limit - 1].id if len(records) > limit else None,
            }
        if path == "/v1/operator/organizations" and ctx["method"] == "GET":
            companies, next_cursor = self.analytics.admin_queries.protocol_page(s, "company", query)
            members = dict(
                s.execute(
                    select(Member.tenant, func.count())
                    .where(Member.tenant.in_([c.id for c in companies]), Member.status == "active")
                    .group_by(Member.tenant)
                ).all()
            )
            return {
                "items": [
                    {
                        "company_id": c.id,
                        "members": members.get(c.id, 0),
                        # A shorter period the organization's administrators chose; None keeps the plan's.
                        "retention_choice": c.data.get("retention_choice"),
                        **{
                            k: c.data[k]
                            for k in (
                                "name",
                                "origin",
                                "domain",
                                "status",
                                "version",
                                "capacity",
                                "retention_months",
                                "plan_id",
                                "plan_version",
                            )
                        },
                    }
                    for c in companies
                ],
                "next_cursor": next_cursor,
            }
        if path == "/v1/operator/exceptions" and ctx["method"] == "GET":
            records, next_cursor = self.analytics.admin_queries.protocol_page(s, "exception", query)
            names = {
                c.id: c.data["name"]
                for c in s.scalars(
                    select(TABLES["company"]).where(TABLES["company"].id.in_({r.tenant for r in records}))
                )
            }
            items = []
            for record in records:
                reversion = get(s, "transition", record.data["reversion_transition_id"], record.tenant)
                items.append(
                    {
                        **{k: v for k, v in record.data.items() if k not in {"request_hash", "reviewer_id", "revoked_by"}},
                        "company_id": record.tenant,
                        "company_name": names.get(record.tenant),
                        # Revoking an exception that shortens retention waits for the admin's acknowledgement.
                        "retention_shortened": bool(reversion and reversion.data.get("retention_shortened")),
                        "acknowledged": bool(reversion and reversion.data.get("acknowledged")),
                    }
                )
            return {"items": items, "next_cursor": next_cursor}
        if path == "/v1/operator/health" and ctx["method"] == "GET":
            transition_cls = TABLES["transition"]
            overdue = s.scalar(
                select(func.count())
                .select_from(transition_cls)
                .where(
                    transition_cls.data["acknowledged"].as_boolean().is_(False),
                    transition_cls.data["effective_at"].as_string() <= instant(self.now()),
                    (
                        (transition_cls.data["retention_shortened"].as_boolean().is_(True))
                        | (transition_cls.data["status"].as_string() == "review_required")
                    ),
                    func.coalesce(transition_cls.data["applied"].as_boolean(), False).is_(False),
                    func.coalesce(transition_cls.data["status"].as_string(), "pending").not_in(
                        ["cancelled", "superseded", "applied"]
                    ),
                )
            )
            return {
                "status": "available",
                "organizations": s.scalar(select(func.count()).select_from(TABLES["company"])),
                "mail_adapter": self.settings.mail_adapter,
                "mail_privacy_verified": self.settings.mail_privacy_verified,
                "retention_transitions_requiring_action": overdue,
            }
        if path == "/v1/operator/audit" and ctx["method"] == "GET":
            return self.analytics.admin_queries.audit(s, None, query, operator=True)
        if path.startswith("/v1/operator/organizations/") and ctx["method"] == "GET":
            company = get(s, "company", path.split("/")[4])
            if not company:
                raise Problem("not_found", 404)
            if path.endswith("/exceptions") or path.endswith("/transitions"):
                kind = "exception" if path.endswith("/exceptions") else "transition"
                records, cursor = self.analytics.admin_queries.protocol_page(s, kind, query, company.id)
                return {
                    "items": [
                        self.transition_result(company, r) if kind == "transition" else r.data
                        for r in records
                    ],
                    "next_cursor": cursor,
                }
            if query:
                raise Problem("unsupported_filter", 422)
            transitions, transitions_cursor = self.analytics.admin_queries.protocol_page(
                s, "transition", {}, company.id
            )
            exceptions, exceptions_cursor = self.analytics.admin_queries.protocol_page(
                s, "exception", {}, company.id
            )
            return {
                "company_id": company.id,
                **{
                    k: company.data[k]
                    for k in (
                        "name",
                        "origin",
                        "domain",
                        "status",
                        "version",
                        "capacity",
                        "retention_months",
                        "plan_id",
                        "plan_version",
                    )
                },
                "entitlement_generation": company.data.get("entitlement_generation", 0),
                "transitions": [self.transition_result(company, r) for r in transitions],
                "exceptions": [r.data for r in exceptions],
                "transitions_next_cursor": transitions_cursor,
                "exceptions_next_cursor": exceptions_cursor,
            }
        if path == "/v1/operator/plans":
            if ctx["method"] == "GET":
                records, next_cursor = self.analytics.admin_queries.protocol_page(s, "plan", query)
                # Exceptions keep a private copy of the plan to return to; it is not a plan to assign.
                return {
                    "items": [r.data for r in records if not r.id.startswith("exception-reversal:")],
                    "next_cursor": next_cursor,
                }
            data = dto.PlanCreate.model_validate_json(canonical(body)).model_dump(mode="json")
            key = data["plan_id"] + ":" + str(data["version"])
            prior = get(s, "plan", key)
            if prior and prior.data != data:
                raise Problem("immutable_plan", 409)
            put(s, "plan", key, data)
            audit("", "plan_created", key)
            return data
        if path.endswith("/status") and ctx["method"] == "PUT":
            data = dto.ServiceStatus.model_validate_json(canonical(body)).model_dump(mode="json")
            company = get(s, "company", path.split("/")[-2])
            if not company:
                raise Problem("not_found", 404)
            if company.data["version"] != data["expected_version"]:
                raise Problem("stale_version", 409)
            if company.data["status"] in {"deletion_scheduled", "deleting"}:
                # Only the organization's administrators cancel a deletion they requested.
                raise Problem("organization_deletion_scheduled", 409)
            self.operator_reauth(s, ctx, data["reauth_token"])
            company.data = {**company.data, "status": data["status"], "version": company.data["version"] + 1}
            audit(
                company.id,
                "service_status_changed",
                company.id,
                {"status": data["status"], "reason": data["reason"]},
            )
            return {"status": data["status"], "version": company.data["version"]}
        if (
            "/transitions/" in path
            and ctx["method"] == "POST"
            and path.rsplit("/", 1)[-1] in {"cancel", "review"}
        ):
            data = dto.TransitionDecision.model_validate_json(canonical(body)).model_dump(mode="json")
            company = get(s, "company", path.split("/")[4])
            transition = get(s, "transition", path.split("/")[-2], company.id) if company else None
            if not transition:
                raise Problem("not_found", 404)
            if (
                data["expected_version"] != transition.data["version"]
                or data["expected_company_version"] != company.data["version"]
            ):
                raise Problem("stale_version", 409)
            if self.transition_state(transition) not in {"pending", "review_required"}:
                raise Problem("transition_terminal", 409)
            if path.endswith("/cancel"):
                if transition.data.get("exception_id"):
                    raise Problem("exception_reversion_required", 409)
                self.operator_reauth(s, ctx, data["reauth_token"])
                self.advance_entitlement(company)
                transition.data = {
                    **transition.data,
                    "status": "cancelled",
                    "cancelled": True,
                    "acknowledged": False,
                    "version": transition.data["version"] + 1,
                    "cancelled_at": instant(self.now()),
                    "cancelled_by": operator_actor,
                    "cancellation_reason": data["reason"],
                }
                restored = None
                if transition.data.get("source_exception_id"):
                    exception = get(s, "exception", transition.data["source_exception_id"], company.id)
                    reversal = get(s, "transition", transition.data["source_reversion_id"], company.id)
                    if (
                        not exception
                        or not reversal
                        or exception.data.get("replacement_transition_id") != transition.id
                        or exception.data["status"] != "superseded"
                    ):
                        raise Problem("transition_review_required", 409)
                    exception.data = {
                        **exception.data,
                        "status": exception.data.get("superseded_prior_status", "active"),
                        "version": exception.data["version"] + 1,
                        "replacement_transition_id": None,
                    }
                    effective = max(self.now(), parse_time(reversal.data["effective_at"]))
                    plan = get(s, "plan", reversal.data["plan"])
                    if not plan:
                        raise Problem("transition_review_required", 409)
                    company.data = {
                        **company.data,
                        "capacity": exception.data["member_capacity"],
                        "retention_months": exception.data["retention_months"],
                        "plan_id": plan.data["plan_id"],
                        "plan_version": plan.data["version"],
                    }
                    reversal.data = {
                        **reversal.data,
                        "status": "pending",
                        "cancelled": False,
                        "applied": False,
                        "acknowledged": False,
                        "version": reversal.data["version"] + 1,
                        "effective_at": instant(effective),
                        "base_generation": company.data["entitlement_generation"],
                        "base_entitlement": self.entitlement_snapshot(company),
                        "retention_shortened": plan.data["retention_months"] is not None
                        and (
                            company.data["retention_months"] is None
                            or plan.data["retention_months"] < company.data["retention_months"]
                        ),
                        "retention_preview": retention_preview(
                            self, s, company, plan.data["retention_months"], effective
                        ),
                        "reviewed_by": operator_actor,
                        "review_reason": data["reason"],
                        "reviewed_at": instant(self.now()),
                    }
                    restored = reversal.id
                audit(
                    company.id,
                    "plan_transition_cancelled",
                    transition.id,
                    {"reason": data["reason"], "restored_reversion_id": restored},
                )
                return {**self.transition_result(company, transition), "restored_reversion_id": restored}
            if self.entitlement_conflict(
                s, company, transition_id=transition.id, exception_id=transition.data.get("exception_id")
            ):
                raise Problem("entitlement_conflict", 409)
            if transition.data.get("exception_id"):
                linked = get(s, "exception", transition.data["exception_id"], company.id)
                if (
                    not linked
                    or linked.data["status"] not in {"active", "revocation_scheduled"}
                    or linked.data["reversion_transition_id"] != transition.id
                ):
                    raise Problem("exception_terminal", 409)
            plan = get(s, "plan", transition.data["plan"])
            if not plan:
                raise Problem("not_found", 404)
            # A reviewed transition can apply a shorter retention, which deletes older usage.
            self.operator_reauth(s, ctx, data["reauth_token"])
            self.advance_entitlement(company)
            effective = max(self.now(), parse_time(transition.data["effective_at"]))
            old, new = company.data["retention_months"], plan.data["retention_months"]
            transition.data = {
                **transition.data,
                "status": "pending",
                "acknowledged": False,
                "version": transition.data["version"] + 1,
                "base_generation": company.data["entitlement_generation"],
                "base_entitlement": self.entitlement_snapshot(company),
                "effective_at": instant(effective),
                "retention_shortened": new is not None and (old is None or new < old),
                "retention_preview": retention_preview(self, s, company, new, effective),
                "error_code": None,
                "reviewed_by": operator_actor,
                "review_reason": data["reason"],
                "reviewed_at": instant(self.now()),
            }
            audit(
                company.id,
                "plan_transition_reviewed",
                transition.id,
                {"reason": data["reason"], "base_generation": company.data["entitlement_generation"]},
            )
            return self.transition_result(company, transition)
        if "/exceptions/" in path and path.endswith("/replace") and ctx["method"] == "POST":
            data = dto.ExceptionReplace.model_validate_json(canonical(body)).model_dump(mode="json")
            company = get(s, "company", path.split("/")[4])
            exception = get(s, "exception", path.split("/")[-2], company.id) if company else None
            plan = get(s, "plan", data["plan_id"] + ":" + str(data["plan_version"]))
            if not exception or not plan:
                raise Problem("not_found", 404)
            reversal = get(s, "transition", exception.data["reversion_transition_id"], company.id)
            if (
                not reversal
                or data["expected_version"] != exception.data["version"]
                or data["expected_company_version"] != company.data["version"]
                or data["expected_entitlement_generation"] != company.data.get("entitlement_generation", 0)
                or data["expected_transition_version"] != reversal.data["version"]
            ):
                raise Problem("stale_version", 409)
            if (
                reversal.data.get("exception_id") != exception.id
                or exception.data["status"] not in {"active", "revocation_scheduled"}
                or self.transition_state(reversal) not in {"pending", "review_required"}
            ):
                raise Problem("exception_terminal", 409)
            if self.entitlement_conflict(s, company, transition_id=reversal.id, exception_id=exception.id):
                raise Problem("entitlement_conflict", 409)
            self.operator_reauth(s, ctx, data["reauth_token"])
            old, new = company.data["retention_months"], plan.data["retention_months"]
            shorter = new is not None and (old is None or new < old)
            self.advance_entitlement(company)
            reversal.data = {
                **reversal.data,
                "status": "superseded",
                "cancelled": True,
                "acknowledged": False,
                "version": reversal.data["version"] + 1,
                "cancelled_by": operator_actor,
                "cancellation_reason": data["reason"],
                "cancelled_at": instant(self.now()),
            }
            exception.data = {
                **exception.data,
                "superseded_prior_status": exception.data["status"],
                "status": "superseded",
                "version": exception.data["version"] + 1,
                "superseded_by": operator_actor,
                "superseded_at": instant(self.now()),
                "replacement_plan": plan.id,
                "replacement_reason": data["reason"],
            }
            transition = None
            if shorter:
                transition = self.make_transition(
                    s,
                    company,
                    plan,
                    self.now(),
                    data["reason"],
                    operator_actor,
                    source_exception_id=exception.id,
                    source_reversion_id=reversal.id,
                )
                exception.data = {**exception.data, "replacement_transition_id": transition.id}
            else:
                company.data = {
                    **company.data,
                    "capacity": plan.data["member_capacity"],
                    "retention_months": new,
                    "plan_id": plan.data["plan_id"],
                    "plan_version": plan.data["version"],
                }
            audit(
                company.id,
                "exception_replaced",
                exception.id,
                {
                    "reason": data["reason"],
                    "plan": plan.id,
                    "superseded_transition_id": reversal.id,
                    "replacement_transition_id": transition.id if transition else None,
                },
            )
            return {
                "status": "retention_transition_pending" if shorter else "assigned",
                "exception_id": exception.id,
                "superseded_transition_id": reversal.id,
                "transition_id": transition.id if transition else None,
                "version": company.data["version"],
                "entitlement_generation": company.data["entitlement_generation"],
            }
        if path.endswith("/entitlement") and ctx["method"] == "PUT":
            data = dto.Assignment.model_validate_json(canonical(body)).model_dump(mode="json")
            company = get(s, "company", path.split("/")[-2])
            plan = get(s, "plan", data["plan_id"] + ":" + str(data["plan_version"]))
            if not company or not plan:
                raise Problem("not_found", 404)
            if data["expected_version"] != company.data["version"]:
                raise Problem("stale_version", 409)
            if self.entitlement_conflict(s, company):
                raise Problem("entitlement_conflict", 409)
            self.operator_reauth(s, ctx, data["reauth_token"])
            effective = max(parse_time(data["effective_at"]), self.now())
            old, new = company.data["retention_months"], plan.data["retention_months"]
            shorter = new is not None and (old is None or new < old)
            self.advance_entitlement(company)
            if shorter or effective > self.now():
                transition = self.make_transition(s, company, plan, effective, data["reason"], operator_actor)
                audit(
                    company.id,
                    "plan_transition_scheduled",
                    transition.id,
                    {
                        "plan": plan.id,
                        "reason": data["reason"],
                        "base_generation": company.data["entitlement_generation"],
                    },
                )
                return {
                    "status": "retention_transition_pending" if shorter else "scheduled",
                    "transition_id": transition.id,
                    "version": company.data["version"],
                    "entitlement_generation": company.data["entitlement_generation"],
                }
            company.data = {
                **company.data,
                "capacity": plan.data["member_capacity"],
                "retention_months": new,
                "plan_id": data["plan_id"],
                "plan_version": data["plan_version"],
            }
            audit(company.id, "plan_assigned", company.id, {"plan": plan.id, "reason": data["reason"]})
            return {
                "status": "assigned",
                "version": company.data["version"],
                "entitlement_generation": company.data["entitlement_generation"],
            }
        if path.endswith("/exceptions") and ctx["method"] == "POST":
            data = dto.ExceptionGrant.model_validate_json(canonical(body)).model_dump(mode="json")
            company = get(s, "company", path.split("/")[4])
            if not company:
                raise Problem("not_found", 404)
            key = digest(company.id + ":exception:" + data["idempotency_key"])
            prior = get(s, "exception", key, company.id)
            # The single-use code is not part of the request, so a retry replays with any code.
            request_hash = digest(canonical({k: v for k, v in data.items() if k != "reauth_token"}))
            if prior:
                if prior.data["request_hash"] != request_hash:
                    raise Problem("idempotency_conflict", 409)
                return {key: value for key, value in prior.data.items() if key != "request_hash"}
            if data["expected_version"] != company.data["version"]:
                raise Problem("stale_version", 409)
            start, end = parse_time(data["effective_at"]), parse_time(data["expires_at"])
            if start > self.now() or end <= self.now() or end <= start:
                raise Problem("invalid_effective_range", 422)
            if self.entitlement_conflict(s, company):
                raise Problem("entitlement_conflict", 409)
            previous = company.data["retention_months"]
            if data["retention_months"] is not None and (
                previous is None or data["retention_months"] < previous
            ):
                raise Problem("retention_transition_pending", 409)
            self.operator_reauth(s, ctx, data["reauth_token"])
            reverse_plan = "exception-reversal:" + key
            put(
                s,
                "plan",
                reverse_plan,
                {
                    "plan_id": company.data["plan_id"],
                    "version": company.data["plan_version"],
                    "member_capacity": company.data["capacity"],
                    "retention_months": previous,
                },
            )
            company.data = {
                **company.data,
                "capacity": data["member_capacity"],
                "retention_months": data["retention_months"],
            }
            self.advance_entitlement(company)
            transition = self.make_transition(
                s,
                company,
                get(s, "plan", reverse_plan),
                end,
                data["reason"],
                operator_actor,
                exception_id=key,
            )
            reversal = transition.id
            result = {
                "exception_id": key,
                "status": "active",
                "version": 1,
                "member_capacity": data["member_capacity"],
                "retention_months": data["retention_months"],
                "effective_at": instant(start),
                "expires_at": instant(end),
                "reason": data["reason"],
                "reversion_transition_id": reversal,
                "reviewer_id": ctx["session"].owner,
                "request_hash": request_hash,
            }
            put(s, "exception", key, result, company.id)
            audit(
                company.id, "exception_granted", key, {"reason": data["reason"], "expires_at": instant(end)}
            )
            return {key: value for key, value in result.items() if key != "request_hash"}
        if "/exceptions/" in path and ctx["method"] == "DELETE":
            data = dto.ExceptionRevoke.model_validate_json(canonical(body)).model_dump(mode="json")
            company = get(s, "company", path.split("/")[4])
            exception = get(s, "exception", path.rsplit("/", 1)[-1], company.id) if company else None
            if not exception:
                raise Problem("not_found", 404)
            if data["expected_version"] != exception.data["version"]:
                raise Problem("stale_version", 409)
            if exception.data["status"] not in {"active", "revocation_scheduled"}:
                raise Problem("exception_terminal", 409)
            transition = get(s, "transition", exception.data["reversion_transition_id"], company.id)
            if not transition or self.transition_state(transition) not in {"pending", "review_required"}:
                raise Problem("transition_terminal", 409)
            if transition.data.get("exception_id") != exception.id or not self.transition_valid(
                company, transition
            ):
                raise Problem("transition_review_required", 409)
            if transition.data["retention_shortened"] and (
                data["transition_acknowledgement"] != transition.id or not transition.data["acknowledged"]
            ):
                raise Problem("retention_transition_pending", 409)
            self.operator_reauth(s, ctx, data["reauth_token"])
            self.advance_entitlement(company)
            transition.data = {
                **transition.data,
                "effective_at": instant(self.now()),
                "acknowledged": transition.data["acknowledged"],
                "base_generation": company.data["entitlement_generation"],
                "version": transition.data["version"] + 1,
            }
            exception.data = {
                **exception.data,
                "status": "revocation_scheduled",
                "version": exception.data["version"] + 1,
                "revocation_reason": data["reason"],
                "revoked_by": operator_actor,
            }
            audit(
                company.id,
                "exception_revocation_scheduled",
                exception.id,
                {"reason": data["reason"], "transition_id": transition.id},
            )
            return {"status": "revocation_scheduled", "transition_id": transition.id}
        raise Problem("not_found", 404)
