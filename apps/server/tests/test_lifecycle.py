import re
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from conftest import connect, login, register
from fastapi.testclient import TestClient
from test_analytics import observations, recompose, upload

from aift.db import rows
from aift.journal import verified_entries


def test_hot_day_revision_path_never_scans_previous_observations(setup, monkeypatch):
    app, client, _, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)

    def no_scan(*args, **kwargs):
        raise AssertionError("ordinary inserts and revisions must use constant-size deltas")

    monkeypatch.setattr(app.state.service.analytics, "selected", no_scan)
    request, attempt = observations(now[0])
    assert upload(client, credentials, [request, attempt]).status_code == 200
    for revision in range(2, 22):
        attempt["revision"] = revision
        attempt["tokens"]["answer_output"]["value"] = str(100 + revision)
        recompose(attempt)
        result = upload(client, credentials, [attempt])
        assert result.status_code == 200, result.text
        assert result.json()["results"][0]["status"] == "applied"
    summary = client.get("/v1/me/summary").json()
    assert summary["attempt_count"] == "1"
    assert next(r["value"] for r in summary["tokens"] if r["quantity"] == "answer_output") == "121"


def test_mixed_batch_progresses_valid_records_and_rejects_only_invalid(setup):
    app, client, _, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    broken = {**request, "request_id": str(uuid4()), "filename": "PRIVATE-FILE-MARKER"}
    response = upload(client, credentials, [broken, request, attempt])
    assert response.status_code == 200, response.text
    assert [r["status"] for r in response.json()["results"]] == ["rejected", "applied", "applied"]
    assert "PRIVATE-FILE-MARKER" not in response.text


def test_resend_replaces_old_code_and_retry_preserves_challenge(setup):
    app, client, _, _, now, _ = setup
    first = client.post(
        "/v1/auth/otp/request",
        json={"purpose": "login", "email": "member@example.org", "dispatch_id": str(uuid4())},
    ).json()
    old_code = app.state.mail.messages[-1]["code"]
    now[0] += timedelta(seconds=61)
    payload = {"challenge_id": first["challenge_id"], "dispatch_id": str(uuid4())}
    second = client.post("/v1/auth/otp/resend", json=payload)
    assert second.status_code == 200, second.text
    assert client.post("/v1/auth/otp/resend", json=payload).json() == second.json()
    assert len(app.state.mail.messages) == 2
    assert (
        client.post(
            "/v1/auth/otp/verify",
            json={"challenge_id": first["challenge_id"], "code": old_code, "verification_id": str(uuid4())},
        ).status_code
        == 401
    )


def test_registration_bootstrap_nonce_origin_and_one_use(self_hosted):
    # The hand-over to the organization's own host remains for self-hosted servers only.
    app, _, settings = self_hosted
    client, verified, verification = register(app, settings)
    assert verified.json()["company_origin"] == settings.self_host_origin
    client.cookies.clear()
    replay = client.post("/v1/auth/otp/verify", json=verification)
    assert replay.status_code == 200 and replay.json() == verified.json()
    assert replay.headers["set-cookie"] == verified.headers["set-cookie"]
    assert (
        client.post("/v1/auth/otp/verify", json={**verification, "verification_id": str(uuid4())}).status_code
        == 401
    )
    started = client.get(verified.json()["destination"], follow_redirects=False)
    assert started.status_code == 303
    authorized = client.get(started.headers["location"])
    assert authorized.status_code == 200
    # Under "no-referrer" a browser sends Origin: null when it posts this form to the organization
    # host, and the exchange refuses that: every live hand-over failed until 13 Oct 2026.
    assert authorized.headers["referrer-policy"] == "strict-origin"
    assert started.headers["referrer-policy"] == "no-referrer"
    fields = dict(re.findall(r'name="([^"]+)" value="([^"]+)"', authorized.text))
    destination = verified.json()["company_origin"] + "/v1/auth/bootstrap/exchange"
    bad = client.post(
        destination,
        data=fields,
        headers={"Origin": "https://evil.footprint.example.net"},
        follow_redirects=False,
    )
    assert bad.status_code == 403
    assert client.post(destination, data=fields, headers={"Origin": "null"}, follow_redirects=False).status_code == 403
    exchanged = client.post(destination, data=fields, follow_redirects=False)
    assert exchanged.status_code == 303 and exchanged.headers["location"] == "/admin"
    # The administrator lands signed in for 7 days (owner decision of 14 Oct 2026).
    signed_in = next(v for v in exchanged.headers.get_list("set-cookie") if v.startswith("__Host-aift="))
    assert f"Max-Age={7 * 86400}" in signed_in
    assert client.post(destination, data=fields, follow_redirects=False).status_code == 403
    with app.state.db.transaction() as s:
        created = next(iter(rows(s, "company")))
        assert created.data["origin"] == settings.self_host_origin
        assert created.data["retention_months"] is None


def test_authenticated_journal_detects_truncation(setup):
    app, _, company, _, _, settings = setup
    marker = {
        "scope": "range",
        "user_id": None,
        "start": "2026-01-01T00:00:00.000Z",
        "end": "2026-01-02T00:00:00.000Z",
        "record_ids": [],
        "epoch": 1,
    }
    app.state.service.analytics.journal(company.id, marker)
    assert (
        list(verified_entries(settings.deletion_journal_path, app.state.service.secrets))[0]["marker"]
        == marker
    )
    Path(settings.deletion_journal_path).write_text("")
    with pytest.raises(RuntimeError, match="journal_head_mismatch"):
        list(verified_entries(settings.deletion_journal_path, app.state.service.secrets))


def test_maximum_counter_sum_correction_and_tiny_resources_are_exact(setup):
    from copy import deepcopy

    from footprint_estimator import estimate_observation

    app, client, _, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, first = observations(now[0], "9223372036854775807")
    second = deepcopy(first)
    second["attempt_id"] = str(uuid4())
    uploaded = upload(client, credentials, [request, first, second])
    assert uploaded.status_code == 200, uploaded.text
    summary = client.get("/v1/me/summary").json()
    assert (
        next(row["value"] for row in summary["tokens"] if row["quantity"] == "answer_output")
        == "18446744073709551614"
    )
    first["revision"] = 2
    first["tokens"]["answer_output"]["value"] = "3"
    recompose(first)
    assert upload(client, credentials, [first]).status_code == 200
    summary = client.get("/v1/me/summary").json()
    assert (
        next(row["value"] for row in summary["tokens"] if row["quantity"] == "answer_output")
        == "9223372036854775810"
    )
    second["revision"] = 2
    second["tokens"]["answer_output"]["value"] = "1"
    recompose(second)
    first["revision"] = 3
    first["tokens"]["answer_output"]["value"] = "0"
    recompose(first)
    assert upload(client, credentials, [first, second]).status_code == 200
    expected = estimate_observation(second)["metrics"]["energy"]["value"]
    summary = client.get("/v1/me/summary").json()
    energy = next(
        row["value"]
        for row in summary["resources"]
        if row["quantity"] == "energy" and row["value"] is not None
    )
    assert energy == expected and "e" not in energy.lower()


def test_registration_has_no_address_and_the_availability_check_is_gone(setup):
    app, _, _, _, _, settings = setup
    client = TestClient(app, base_url=settings.registration_origin)
    client.headers["Origin"] = settings.registration_origin
    # Organizations no longer choose an address, so the old field is refused rather than ignored.
    refused = client.post(
        "/v1/organizations/registrations",
        json={
            "company_name": "New company",
            "website": "https://fresh.org",
            "country": "DE",
            "work_domain": "fresh.org",
            "admin_email": "admin@fresh.org",
            "registrant_name": "Registrant",
            "registrant_role": "Director",
            "slug": "fresh-company",
            "terms_version": "1.0.0",
            "disclosure_version": "1.0.0",
            "authority_acknowledged": True,
            "idempotency_key": str(uuid4()),
        },
    )
    assert refused.status_code == 422
    gone = client.get("/v1/organizations/address-availability", params={"slug": "fresh-company"})
    assert gone.status_code in {401, 404}
    assert "available" not in gone.text


def test_developer_panel_has_its_own_default_origin():
    from aift.config import Settings

    assert Settings(database_url="sqlite://").operator_origin == "https://developer.aifootprinttracker.com"
