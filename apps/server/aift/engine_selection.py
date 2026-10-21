"""Installation preferences select self-scoped jobs without changing stored originals."""

import re
from uuid import NAMESPACE_URL, UUID, uuid5

from footprint_contracts import payload_hash

from . import method_registry
from .db import get
from .method_history import RecalculationJob
from .security import Problem, canonical, digest, instant

SELECTION_FIELDS = frozenset({"preference", "selection_revision", "method_id", "method_hash", "operation_id"})


def _validate(body):
    if not isinstance(body, dict) or set(body) != SELECTION_FIELDS:
        raise Problem("invalid_payload", 422)
    if (
        not isinstance(body["preference"], str)
        or body["preference"] not in {"build_default", "original", "ecologits"}
        or type(body["selection_revision"]) is not int
        or not 1 <= body["selection_revision"] <= 2147483647
        or not isinstance(body["method_id"], str)
        or not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,127}", body["method_id"])
        or not isinstance(body["method_hash"], str)
        or not re.fullmatch(r"[a-f0-9]{64}", body["method_hash"])
        or not isinstance(body["operation_id"], str)
        or len(body["operation_id"]) != 36
    ):
        raise Problem("invalid_payload", 422)
    try:
        operation = str(UUID(body["operation_id"]))
        if operation != body["operation_id"].lower():
            raise ValueError()
    except ValueError:
        raise Problem("invalid_payload", 422) from None
    return {**body, "operation_id": operation}


def _compatibility(session, selection):
    """Whether the selected method can run here. A person's own summary with a choice asks three
    times (the choice's status, its job, the view) and each check of an EcoLogits method reads the
    native runtime's profiles; a read memo keeps the answer for the request."""
    from .history_matching import remembered

    return remembered(
        session,
        ("selection compatibility", selection["method_id"], selection["method_hash"], selection["preference"]),
        lambda: _check_compatibility(session, selection),
    )


def _check_compatibility(session, selection):
    try:
        method = method_registry.resolve(session, selection["method_id"])
    except Problem as error:
        if error.code != "method_unsupported":
            raise
        return {"status": "pending", "reason": error.code}
    if payload_hash(method) != selection["method_hash"]:
        return {"status": "pending", "reason": "method_hash_mismatch"}
    engine = method.get("engine_id", "original")
    if engine not in {"original", "ecologits"} or selection["preference"] not in {
        "build_default",
        engine,
    }:
        return {"status": "pending", "reason": "engine_mismatch"}
    if engine == "ecologits":
        from .engine_adapter import require_native

        try:
            require_native(method)
        except Problem as error:
            if error.code != "engine_unavailable":
                raise
            return {"status": "pending", "reason": error.code}
    return {"status": "supported", "reason": None}


def selection_is_current(session, job):
    """Guard work and publication; manual jobs retain their existing readiness rules."""
    if "selection_device_id" not in job.data:
        return True
    device = get(session, "device", job.data["selection_device_id"], job.tenant)
    member = get(session, "member", job.owner, job.tenant)
    if (
        not device
        or device.owner != job.owner
        or device.data["status"] != "active"
        or not member
        or member.data["status"] != "active"
        or job.actor != job.owner
    ):
        return False
    selection = device.data.get("estimation_selection")
    if not selection or any(
        left != right
        for left, right in (
            (selection["job_id"], job.id),
            (selection["method_id"], job.method_id),
            (selection["selection_revision"], job.data.get("selection_revision")),
            (selection["selection_generation"], job.data.get("selection_generation")),
            (selection["method_hash"], job.data.get("selection_method_hash")),
            (selection["operation_id"], job.data.get("selection_operation_id")),
            (selection["preference"], job.data.get("selection_preference")),
        )
    ):
        return False
    # A method installed later must match the identity selected while it was unavailable.
    return _compatibility(session, selection)["reason"] in {None, "method_unsupported", "engine_unavailable"}


def _response(analytics, session, company, member, device):
    selection = device.data.get("estimation_selection")
    if selection is None:
        return {"selection": None, "compatibility": None, "recalculation": None}
    compatibility = _compatibility(session, selection)
    job = session.get(RecalculationJob, selection["job_id"])
    if job is None:
        recalculation = {
            "job_id": selection["job_id"],
            "status": "invalidated",
            "completed_at": None,
            "error_code": "deletion_changed",
        }
    else:
        recalculation = analytics.methods.status(session, company, member, job.id, personal=True)
        if compatibility["status"] != "supported" and recalculation["status"] != "invalidated":
            recalculation = {
                **recalculation,
                "status": "pending",
                "completed_at": None,
                "error_code": compatibility["reason"],
            }
        elif recalculation["status"] != "invalidated" and not selection_is_current(session, job):
            recalculation = {
                **recalculation,
                "status": "superseded",
                "completed_at": None,
                "error_code": "selection_changed",
            }
    return {"selection": dict(selection), "compatibility": compatibility, "recalculation": recalculation}


def handle_selection(analytics, s, company, member, device, method, body, query):
    """Handle GET/PUT inside the existing authenticated tenant transaction."""
    if not device:
        raise Problem("installation_required", 403)
    device = get(s, "device", device.id, company.id)
    member = get(s, "member", member.id, company.id)
    if (
        not device
        or not member
        or device.owner != member.id
        or device.data["status"] != "active"
        or member.data["status"] != "active"
    ):
        raise Problem("enrollment_revoked", 403)
    if method not in {"GET", "PUT"} or query or (method == "GET" and body):
        raise Problem("invalid_payload", 422)
    if method == "GET":
        return _response(analytics, s, company, member, device)
    requested = _validate(body)
    previous = device.data.get("estimation_selection")
    if previous and requested["selection_revision"] <= previous["selection_revision"]:
        if all(requested[key] == previous[key] for key in SELECTION_FIELDS):
            return _response(analytics, s, company, member, device)
        raise Problem("selection_revision_conflict", 409)
    compatibility = _compatibility(s, requested)
    if compatibility["reason"] not in {None, "method_unsupported", "engine_unavailable"}:
        raise Problem(compatibility["reason"], 409)

    # Namespace operations by installation so another installation cannot adopt its job.
    operation = str(
        uuid5(
            NAMESPACE_URL,
            canonical(["estimation-selection", company.id, member.id, device.id, requested["operation_id"]]),
        )
    )
    identifier = digest(canonical([company.id, member.id, operation]))
    if s.get(RecalculationJob, identifier) is not None:
        raise Problem("idempotency_conflict", 409)
    created = analytics.methods.create(
        s, company, member, {"method_id": requested["method_id"], "operation_id": operation}, personal=True
    )
    job = s.get(RecalculationJob, created["job_id"])
    generation = previous["selection_generation"] + 1 if previous else 1
    selection = {
        **requested,
        "selection_generation": generation,
        "job_id": job.id,
        "updated_at": instant(analytics.service.now()),
    }
    job.data = {
        **job.data,
        "selection_device_id": device.id,
        "selection_revision": requested["selection_revision"],
        "selection_generation": generation,
        "selection_method_hash": requested["method_hash"],
        "selection_operation_id": requested["operation_id"],
        "selection_preference": requested["preference"],
    }
    if previous:
        old_job = s.get(RecalculationJob, previous["job_id"])
        if (
            old_job
            and old_job.tenant == company.id
            and old_job.owner == member.id
            and old_job.data.get("selection_device_id") == device.id
        ):
            old_job.data = {
                **old_job.data,
                "status": "superseded",
                "error_code": "selection_changed",
                "completed_at": None,
            }
    device.data = {**device.data, "estimation_selection": selection}
    s.flush()
    return _response(analytics, s, company, member, device)
