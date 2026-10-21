"""Deployment-approved data bundles. Trust keys never come from the supplied envelope."""

import argparse
import base64
import hashlib
import json
import re
from collections import OrderedDict
from datetime import timedelta
from pathlib import Path
from threading import Lock

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from footprint_contracts import canonical_json, payload_hash
from footprint_estimator import (
    BASELINE_METHOD_ID,
    baseline_bundle,
    validate_method_bundle,
)
from sqlalchemy import JSON, String, event, select
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base, get, put
from .security import Problem, instant, parse_time

MAX_BUNDLE_BYTES = 2 * 1024 * 1024
MAX_METHODS = 32


def public_key_bytes(value):
    try:
        if not isinstance(value, str) or not 1 <= len(value) <= 512:
            raise ValueError()
        raw = base64.b64decode(value, validate=True)
        key = serialization.load_der_public_key(raw)
        if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
            raise ValueError()
        return raw
    except Exception:
        raise ValueError("configuration_required: method trust key") from None


def delivery_key(method_id):
    return hashlib.sha256(("method-delivery-v1:" + method_id).encode()).hexdigest()


def delivery_approval(session, row):
    renewed = get(session, "maintenance_cursor", delivery_key(row.method_id))
    if renewed:
        if (
            renewed.tenant
            or renewed.owner
            or renewed.data.get("domain") != "method_delivery_v1"
            or renewed.data.get("bundle_hash") != row.method_hash
        ):
            raise Problem("method_integrity_failed", 503)
        return renewed.data["approval"]
    return row.approval


def delivery_inventory(session, trusted_spki):
    if not trusted_spki:
        return {"delivery_status": "trust_unconfigured", "trust_fingerprint": None, "methods": []}
    fingerprint = hashlib.sha256(public_key_bytes(trusted_spki)).hexdigest()
    result = []
    for row in session.scalars(select(MethodBundle).order_by(MethodBundle.method_id).limit(MAX_METHODS)):
        approval = delivery_approval(session, row)
        if approval.get("key_fingerprint") == fingerprint:
            result.append(
                {
                    "method_id": row.method_id,
                    "method_hash": row.method_hash,
                    "issued_at": approval["issued_at"],
                    "expires_at": approval["expires_at"],
                }
            )
    return {"delivery_status": "available", "trust_fingerprint": fingerprint, "methods": result}


def delivery(session, method_id, trusted_spki, now):
    if not trusted_spki:
        raise Problem("method_trust_unconfigured", 409)
    if (
        not isinstance(method_id, str)
        or not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,127}", method_id)
        or method_id in {".", ".."}
    ):
        raise Problem("invalid_payload", 422)
    row = session.get(MethodBundle, method_id)
    if not row:
        raise Problem("method_unsupported", 404)
    approval = delivery_approval(session, row)
    if approval.get("key_fingerprint") != hashlib.sha256(public_key_bytes(trusted_spki)).hexdigest():
        raise Problem("method_trust_changed", 409)
    envelope = {
        "bundle": resolve(session, method_id),
        "bundle_hash": row.method_hash,
        **{name: approval[name] for name in ("issued_at", "expires_at", "signature")},
    }
    # Recheck persisted delivery data without admitting or rewriting historical method records.
    verify_envelope(envelope, trusted_spki, now)
    return envelope


class MethodBundle(Base):
    __tablename__ = "method_bundles"
    method_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    method_hash: Mapped[str] = mapped_column(String(64), unique=True)
    bundle: Mapped[dict] = mapped_column(JSON)
    approval: Mapped[dict] = mapped_column(JSON)
    installed_at: Mapped[str] = mapped_column(String(24))


@event.listens_for(MethodBundle, "before_update")
def immutable_bundle(mapper, connection, target):
    raise ValueError("immutable_method_history")


# Checked stored bundles by (method_id, method_hash): the stored JSON as text and the bundle's
# identity. Validating and hashing a bundle costs far more than comparing its text, and summaries
# and the worker resolve the same few methods for every record. Bounded by the registry size.
_CHECKED = OrderedDict()
_CHECKED_LIMIT = 2 * MAX_METHODS
_CHECKED_LOCK = Lock()
_PACKAGED = []


def packaged_identity():
    """The packaged definition and its identity, hashed once per definition object."""
    from .engine_adapter import identity, packaged_definition

    definition = packaged_definition()
    with _CHECKED_LOCK:
        if _PACKAGED and _PACKAGED[0] is definition:
            return definition, _PACKAGED[1]
    method = identity(definition)
    with _CHECKED_LOCK:
        _PACKAGED[:] = [definition, method]
    return definition, method


def resolve(session, method_id):
    if method_id == BASELINE_METHOD_ID:
        return baseline_bundle()
    return resolve_identity(session, method_id)[0]


def resolve_identity(session, method_id):
    """resolve() and the method's identity, with each stored bundle checked once per process."""
    from .engine_adapter import identity

    if method_id == "unavailable-admission-v1":
        raise Problem("method_unsupported", 409, True)
    if method_id == BASELINE_METHOD_ID:
        bundle = baseline_bundle()
        return bundle, identity(bundle)
    packaged, method = packaged_identity()
    if method_id == method["method_id"]:
        return packaged, method
    # The session holds rows weakly; keeping the row makes it one read per transaction.
    held = session.info.setdefault("method_bundle_rows", {})
    row = held.get(method_id) or session.get(MethodBundle, method_id)
    if row is None:
        raise Problem("method_unsupported", 409, True)
    held[method_id] = row
    key = (method_id, row.method_hash)
    # The stored JSON is compared in full (true and 1 differ in JSON text), so a row whose content
    # changed under the same hash is validated again and still fails its integrity check.
    stored = json.dumps(row.bundle, sort_keys=True)
    with _CHECKED_LOCK:
        checked = _CHECKED.get(key)
        if checked:
            _CHECKED.move_to_end(key)
    ecologits = row.bundle.get("engine_id") == "ecologits"
    if checked and checked[0] == stored:
        # The same objects the validators return: the stored row itself or a fresh copy.
        return (row.bundle if ecologits else json.loads(json.dumps(row.bundle))), checked[1]
    if ecologits:
        from estimation_contracts import validate_method_definition

        bundle = validate_method_definition(row.bundle)
        method = identity(bundle)
        if method["method_id"] != method_id:
            raise Problem("method_integrity_failed", 503)
    else:
        bundle = validate_method_bundle(row.bundle)
        method = identity(bundle)
    if payload_hash(bundle) != row.method_hash:
        raise Problem("method_integrity_failed", 503)
    with _CHECKED_LOCK:
        _CHECKED[key] = (stored, method)
        while len(_CHECKED) > _CHECKED_LIMIT:
            _CHECKED.popitem(last=False)
    return bundle, method


def engine_inventory(definition, installed_at=None):
    from .engine_adapter import identity, require_native

    method = identity(definition)
    try:
        require_native(definition)
        state = "supported"
    except Problem:
        state = "unavailable"
    return {
        **method,
        "default": False,
        "state": state,
        "equation_id": f"native-ecologits-{method['source_version']}",
        "validation_state": "unvalidated_reference",
        "approval": {"trust": "packaged_release"},
        "installed_at": installed_at,
        "provenance": {"source_commit": method["source_commit"]},
        "result_schema_version": "3.0.0",
    }


def inventory(session):
    baseline = baseline_bundle()
    records = [
        {
            "method_id": BASELINE_METHOD_ID,
            "method_hash": payload_hash(baseline),
            "equation_id": baseline["equation_id"],
            "default": True,
            "state": "supported",
            "validation_state": baseline["validation_state"],
            "provenance": baseline["provenance"],
            "approval": {"trust": "packaged_release"},
            "installed_at": None,
        }
    ]
    for row in session.scalars(select(MethodBundle).order_by(MethodBundle.method_id).limit(MAX_METHODS)):
        if row.bundle.get("engine_id") == "ecologits":
            records.append(engine_inventory(resolve(session, row.method_id), row.installed_at))
            continue
        records.append(
            {
                "method_id": row.method_id,
                "method_hash": row.method_hash,
                "equation_id": row.bundle["equation_id"],
                "default": False,
                "state": "supported",
                "validation_state": row.bundle["validation_state"],
                "provenance": row.bundle["provenance"],
                "approval": row.approval,
                "installed_at": row.installed_at,
            }
        )
    from .engine_adapter import identity, packaged_definition

    definition = packaged_definition()
    current = identity(definition)
    if not any(record["method_id"] == current["method_id"] for record in records):
        records.append(engine_inventory(definition))
    # New estimates use the packaged EcoLogits method (default_engine "ecologits"); the baseline
    # stays listed as the archived Original method. Until 19 Oct 2026 the inventory named the
    # baseline as the default, and the admin Health page said figures were calculated with it.
    for record in records:
        record["default"] = record["method_id"] == current["method_id"]
    return {
        "default_method_id": current["method_id"],
        "methods": records,
        "supported_result_schema_versions": ["3.0.0"],
        "supported_history_schema_versions": ["3.0.0"],
        "engine_selection_schema_version": "1.0.0",
    }


def estimate(session, observation, options=None, *, request=None, tenant=None, owner=None, history=None):
    from .engine_adapter import estimate as native_estimate
    from .engine_history import canonical_request_binding
    from .history_matching import linked_history

    options = options or {}
    method_id = options.get("methodId") or observation.get("proposed_method_id") or BASELINE_METHOD_ID
    definition = resolve(session, method_id)
    binding = canonical_request_binding(session, tenant, owner, observation, request) if request else None
    if history is None and request is not None and options.get("view") == "recalculated":
        linked = linked_history(session, tenant, owner, observation, request)
        history = linked.payload if linked else None
    return native_estimate(
        definition, observation, request, options, canonical_binding=binding, history=history
    )


def estimate_history(session, observation, options=None):
    from .engine_adapter import estimate as native_estimate

    options = options or {}
    missing_original = options.get("originalMethodMissing", False)
    if (
        not isinstance(missing_original, bool)
        or missing_original
        or observation.get("proposed_method_id") == "unavailable-admission-v1"
    ):
        raise Problem("method_update_invalid", 422)
    method_id = options.get("methodId") or observation["proposed_method_id"]
    definition = resolve(session, method_id)
    if not options.get("methodId") and payload_hash(definition) != observation["proposed_method_hash"]:
        raise Problem("method_update_invalid", 422)
    return native_estimate(definition, observation, options=options)


def retain_packaged_definition(session, method_id, now):
    """Mutation paths archive reviewed product policy so later builds can resolve old method hashes."""
    from .engine_adapter import identity, packaged_definition

    definition = packaged_definition()
    method = identity(definition)
    if method_id != method["method_id"] or session.get(MethodBundle, method_id):
        return
    if len(list(session.scalars(select(MethodBundle.method_id).limit(MAX_METHODS)))) >= MAX_METHODS - 1:
        raise Problem("method_registry_full", 409, True)
    session.add(
        MethodBundle(
            method_id=method_id,
            method_hash=method["method_hash"],
            bundle=definition,
            approval={"trust": "packaged_release"},
            installed_at=instant(now),
        )
    )
    session.flush()


def verify_envelope(envelope, trusted_spki, now):
    try:
        if set(envelope) != {"bundle", "bundle_hash", "issued_at", "expires_at", "signature"}:
            raise ValueError()
        if len(canonical_json(envelope).encode()) > MAX_BUNDLE_BYTES:
            raise ValueError()
        issued, expires = parse_time(envelope["issued_at"]), parse_time(envelope["expires_at"])
        if (
            instant(issued) != envelope["issued_at"]
            or instant(expires) != envelope["expires_at"]
            or issued > now + timedelta(minutes=5)
            or expires <= now
            or expires <= issued
        ):
            raise ValueError()
        bundle = validate_method_bundle(envelope["bundle"])
        if (
            not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,127}", bundle["method_id"])
            or payload_hash(bundle) != envelope["bundle_hash"]
        ):
            raise ValueError()
        if bundle["equation_id"] == "test-linear-v1":
            raise ValueError()
        from urllib.parse import urlsplit

        for value in [
            bundle["provenance"]["url"],
            bundle["scenario"]["provenance"]["url"],
            *(p["architecture_source"] for p in bundle["profiles"]),
        ]:
            url = urlsplit(value)
            if len(value) > 2048 or url.scheme != "https" or not url.hostname or url.username or url.password:
                raise ValueError()
        key_bytes = base64.b64decode(trusted_spki, validate=True)
        key = serialization.load_der_public_key(key_bytes)
        if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
            raise ValueError()
        signature = base64.b64decode(envelope["signature"], validate=True)
        if len(signature) != 64:
            raise ValueError()
        der = encode_dss_signature(int.from_bytes(signature[:32]), int.from_bytes(signature[32:]))
        message = canonical_json(
            {name: envelope[name] for name in ("bundle_hash", "issued_at", "expires_at")}
        )
        key.verify(der, message.encode(), ec.ECDSA(hashes.SHA256()))
    except Exception:
        raise Problem("method_update_invalid", 422) from None
    return bundle, key_bytes


def install(session, envelope, trusted_spki, now, *, approved_by, environment="production"):
    """Caller holds the deployment method-install lock; immutable historical approval stays intact."""
    if not isinstance(approved_by, str) or not approved_by.strip() or len(approved_by) > 160:
        raise Problem("method_update_invalid", 422)
    bundle, key_bytes = verify_envelope(envelope, trusted_spki, now)
    method_id = bundle["method_id"]
    if method_id == BASELINE_METHOD_ID:
        if payload_hash(baseline_bundle()) != envelope["bundle_hash"]:
            raise Problem("method_conflict", 409)
        return envelope["bundle_hash"]
    existing = session.get(MethodBundle, method_id)
    if existing:
        if existing.method_hash != envelope["bundle_hash"]:
            raise Problem("method_conflict", 409)
        return existing.method_hash
    if len(list(session.scalars(select(MethodBundle.method_id).limit(MAX_METHODS)))) >= MAX_METHODS - 1:
        raise Problem("method_registry_full", 409)
    session.add(
        MethodBundle(
            method_id=method_id,
            method_hash=envelope["bundle_hash"],
            bundle=bundle,
            approval={
                "trust": "deployment_pinned_p256_signature",
                "key_fingerprint": hashlib.sha256(key_bytes).hexdigest(),
                "approved_by": approved_by,
                "issued_at": envelope["issued_at"],
                "expires_at": envelope["expires_at"],
                "signature": envelope["signature"],
            },
            installed_at=instant(now),
        )
    )
    session.flush()
    return envelope["bundle_hash"]


def renew_delivery(session, envelope, trusted_spki, now, *, approved_by):
    bundle, key_bytes = verify_envelope(envelope, trusted_spki, now)
    row = session.get(MethodBundle, bundle["method_id"])
    if not row or row.method_hash != envelope["bundle_hash"]:
        raise Problem("method_conflict", 409)
    if not isinstance(approved_by, str) or not 1 <= len(approved_by.strip()) <= 160:
        raise Problem("method_update_invalid", 422)
    previous = delivery_approval(session, row)
    if parse_time(envelope["issued_at"]) <= parse_time(previous["issued_at"]):
        if all(envelope[name] == previous[name] for name in ("issued_at", "expires_at", "signature")):
            return row.method_hash
        raise Problem("method_conflict", 409)
    # One bounded current delivery approval per approved method; original approval is never replaced.
    put(
        session,
        "maintenance_cursor",
        delivery_key(row.method_id),
        {
            "domain": "method_delivery_v1",
            "bundle_hash": row.method_hash,
            "approval": {
                "key_fingerprint": hashlib.sha256(key_bytes).hexdigest(),
                "approved_by": approved_by,
                **{name: envelope[name] for name in ("issued_at", "expires_at", "signature")},
            },
        },
    )
    return row.method_hash


def main():
    from datetime import UTC, datetime

    from .config import Settings
    from .db import Database

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument(
        "--trusted-spki", required=True, type=Path, help="Deployment-pinned base64 P-256 SPKI file"
    )
    parser.add_argument("--approved-by", required=True)
    parser.add_argument(
        "--renew-delivery",
        action="store_true",
        help="Renew only delivery approval for an already approved unchanged bundle",
    )
    args = parser.parse_args()
    if args.bundle.stat().st_size > MAX_BUNDLE_BYTES:
        parser.error("Bundle exceeds 2 MiB")
    settings = Settings.from_environment()
    trusted_spki = args.trusted_spki.read_text().strip()
    if settings.method_public_key and trusted_spki != settings.method_public_key:
        raise SystemExit("Configured method trust key differs from the supplied deployment key")
    database = Database(settings)
    with database.transaction(scope="method-install") as session:
        method_hash = (renew_delivery if args.renew_delivery else install)(
            session,
            json.loads(args.bundle.read_text(encoding="utf-8-sig")),
            trusted_spki,
            datetime.now(UTC),
            approved_by=args.approved_by,
        )
    print(json.dumps({"method_hash": method_hash, "status": "installed"}))


if __name__ == "__main__":
    main()
