import base64
import copy
from dataclasses import replace
from datetime import timedelta

import pytest
from conftest import connect, login, member_login
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from footprint_contracts import canonical_json, payload_hash
from footprint_estimator import baseline_bundle

from aift.db import get
from aift.method_registry import MethodBundle, delivery_key, install, renew_delivery
from aift.security import Problem, instant


def signed(now, name="signed-runtime-v1", key=None, **changes):
    key = key or ec.generate_private_key(ec.SECP256R1())
    public = base64.b64encode(
        key.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
        )
    ).decode()
    bundle = copy.deepcopy(baseline_bundle())
    bundle["method_id"] = name
    bundle.update(changes)
    envelope = {
        "bundle": bundle,
        "bundle_hash": payload_hash(bundle),
        "issued_at": instant(now),
        "expires_at": instant(now + timedelta(seconds=60)),
    }
    signature = key.sign(
        canonical_json({k: envelope[k] for k in ("bundle_hash", "issued_at", "expires_at")}).encode(),
        ec.ECDSA(hashes.SHA256()),
    )
    r, s = decode_dss_signature(signature)
    envelope["signature"] = base64.b64encode(r.to_bytes(32, "big") + s.to_bytes(32, "big")).decode()
    return envelope, public, key


def paired(setup, public):
    app, client, company, admin, now, settings = setup
    app.state.service.settings = replace(settings, method_public_key=public)
    login(app, client)
    credentials, _ = connect(app, client)
    client.cookies.clear()
    client.headers["Authorization"] = "Bearer " + credentials["access_token"]
    return credentials


def test_authenticated_enrollment_pins_separate_key_and_delivers_exact_approved_envelope(setup):
    app, client, _, _, now, _ = setup
    envelope, public, _ = signed(now[0])
    credentials = paired(setup, public)
    assert credentials["method_public_key"] == public
    assert "method_public_key" not in client.get("/v1/config").json()
    with app.state.db.transaction(scope="method-install") as session:
        install(session, envelope, public, now[0], approved_by="synthetic-reviewer")
    index = client.get("/v1/me/method-updates")
    assert index.status_code == 200
    assert index.json()["delivery_status"] == "available"
    assert len(index.json()["methods"]) == 1
    result = client.get("/v1/me/method-updates/signed-runtime-v1")
    assert result.status_code == 200
    assert result.json() == envelope
    assert "approved_by" not in result.text
    assert "key" not in result.json()
    assert client.get("/v1/me/method-updates?url=https://untrusted.example").status_code == 422
    assert client.post("/v1/me/method-updates", json=envelope).status_code == 422
    client.headers.pop("Authorization")
    assert client.get("/v1/me/method-updates").status_code == 401
    login(app, client)
    assert client.get("/v1/me/method-updates").status_code == 403


def test_legacy_enrollment_without_method_key_still_works(setup):
    _, client, _, _, _, _ = setup
    credentials = paired(setup, "")
    assert credentials["method_public_key"] is None
    assert client.get("/v1/me/method-updates").json() == {
        "delivery_status": "trust_unconfigured",
        "trust_fingerprint": None,
        "methods": [],
    }


def test_expired_delivery_can_be_renewed_without_rewriting_original_approval(setup):
    app, client, _, _, now, _ = setup
    original, public, key = signed(now[0])
    paired(setup, public)
    with app.state.db.transaction(scope="method-install") as session:
        install(session, original, public, now[0], approved_by="first-reviewer")
        first = copy.deepcopy(session.get(MethodBundle, "signed-runtime-v1").approval)
    now[0] += timedelta(seconds=61)
    assert client.get("/v1/me/method-updates/signed-runtime-v1").status_code == 422
    renewed, _, _ = signed(now[0], key=key)
    assert renewed["bundle_hash"] == original["bundle_hash"]
    with app.state.db.transaction(scope="method-install") as session:
        renew_delivery(session, renewed, public, now[0], approved_by="delivery-reviewer")
        renew_delivery(session, renewed, public, now[0], approved_by="delivery-reviewer")
        assert session.get(MethodBundle, "signed-runtime-v1").approval == first
        assert (
            get(session, "maintenance_cursor", delivery_key("signed-runtime-v1")).data["domain"]
            == "method_delivery_v1"
        )
    assert client.get("/v1/me/method-updates/signed-runtime-v1").json() == renewed
    altered, _, _ = signed(
        now[0] + timedelta(seconds=1),
        key=key,
        coefficients={**original["bundle"]["coefficients"], "energyAlpha": "2"},
    )
    with (
        app.state.db.transaction(scope="method-install") as session,
        pytest.raises(Problem, match="method_conflict"),
    ):
        renew_delivery(session, altered, public, now[0], approved_by="delivery-reviewer")


@pytest.mark.parametrize(
    "mutation", ["signature", "hash", "test-equation", "script-url", "oversize", "expired"]
)
def test_invalid_update_never_creates_registry_or_delivery_record(setup, mutation):
    app, _, _, _, now, _ = setup
    changes = {"equation_id": "test-linear-v1"} if mutation == "test-equation" else {}
    if mutation == "script-url":
        changes["provenance"] = {**baseline_bundle()["provenance"], "url": "javascript:alert(1)"}
    envelope, public, _ = signed(now[0], "test-invalid-v1", **changes)
    if mutation == "signature":
        envelope["signature"] = "AA=="
    if mutation == "hash":
        envelope["bundle_hash"] = "0" * 64
    if mutation == "oversize":
        envelope["bundle"]["reviewer"] = "x" * (2 * 1024 * 1024)
    clock = now[0] + timedelta(seconds=61) if mutation == "expired" else now[0]
    with pytest.raises(Problem), app.state.db.transaction(scope="method-install") as session:
        install(session, envelope, public, clock, approved_by="synthetic-reviewer")
    with app.state.db.transaction() as session:
        assert session.get(MethodBundle, "test-invalid-v1") is None
        assert get(session, "maintenance_cursor", delivery_key("test-invalid-v1")) is None


def test_revoked_installation_cannot_download_and_key_rotation_needs_new_enrollment(setup):
    app, client, company, _, now, _ = setup
    envelope, public, _ = signed(now[0])
    credentials = paired(setup, public)
    with app.state.db.transaction(scope="method-install") as session:
        install(session, envelope, public, now[0], approved_by="synthetic-reviewer")
    _, changed, _ = signed(now[0])
    app.state.service.settings = replace(app.state.service.settings, method_public_key=changed)
    assert client.get("/v1/me/method-updates").json()["methods"] == []
    assert client.get("/v1/me/method-updates/signed-runtime-v1").status_code == 409
    with app.state.db.transaction() as session:
        device = get(session, "device", credentials["device_id"], company.id)
        device.data = {**device.data, "status": "revoked"}
    assert client.get("/v1/me/method-updates").status_code == 403


def test_ready_own_summary_is_not_blocked_by_a_stale_larger_job(setup):
    from fastapi.testclient import TestClient
    from test_analytics import observations, upload
    from test_method_history import begin, create_job, install_bundle, tick

    from aift.method_history import RecalculationJob

    app, client, company, member, now, _, _, _ = begin(setup)
    with app.state.db.transaction() as session:
        app.state.service.member(session, company, "other@example.org", False)
    other = TestClient(app, base_url=company.data["origin"])
    other.headers["Origin"] = company.data["origin"]
    member_login(app, other, "other@example.org")
    credentials, _ = connect(app, other)
    bundle = install_bundle(app, now[0])
    history, own_job = create_job(app, company, member, bundle["method_id"])
    tick(app, company, history, own_job)
    with app.state.db.transaction() as session:
        session.add(
            RecalculationJob(
                id="0" * 64,
                tenant=company.id,
                owner=None,
                actor=member.id,
                method_id=bundle["method_id"],
                data={
                    "status": "completed",
                    "created_at": instant(now[0]),
                    "processed": 1,
                    "completed_at": instant(now[0]),
                    "error_code": None,
                    "deletion_epoch": company.data["epoch"],
                },
            )
        )
    assert upload(other, credentials, observations(now[0])).status_code == 200
    query = {"calculation_view": "recalculated", "method_id": bundle["method_id"]}
    mine = client.get("/v1/me/summary", params=query)
    assert mine.status_code == 200
    assert mine.json()["method_hash"] == payload_hash(bundle)
    assert client.get("/v1/admin/summary", params=query).status_code == 409
    other.close()
