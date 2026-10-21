import base64
from copy import deepcopy
from datetime import timedelta
from uuid import uuid4

from conftest import PERSON_ANALYTICS, confirmed, connect, login, member_login
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from footprint_contracts import compose_output_total
from footprint_estimator import BASELINE_METHOD_ID
from sqlalchemy import select

from aift.db import Observation, get, put, rows
from aift.security import canonical, digest, instant, token


def recompose(attempt):
    """3.0.0 attempts carry the composite of their parts unless the provider reports the total."""
    attempt["tokens"]["output_total"] = compose_output_total(attempt["tokens"])
    return attempt


def observations(now, count="500"):
    request = {
        "schema_version": "3.0.0",
        "kind": "request",
        "request_id": str(uuid4()),
        "revision": 1,
        "conversation_key": "a" * 64,
        "key_version": "1",
        "provider_request_key": None,
        "site": "chatgpt",
        "adapter_version": "0.1.0",
        "action": "send",
        "dispatched_at": instant(now),
        "ended_at": instant(now),
        "state": "completed",
        "model_id": None,
        "model_evidence": "unknown",
        "features": ["text"],
        "observed_search_operations": None,
        "documents": {"extracted_text": None, "upload_count": None, "types": [], "processing": "none"},
        "media": {"input_images": [], "requested_operations": [], "coverage_reasons": []},
        "coverage_reasons": [],
        "policy_version": "1.0.0",
        "company_dedup_key": None,
    }
    fields = [
        "new_input_text",
        "logical_input_total",
        "input_uncached",
        "input_cache_read",
        "input_cache_write",
        "answer_output",
        "visible_thinking",
        "reported_reasoning",
        "output_total",
        "tool_input",
        "intermediate_output",
        "tool_output",
        "image_input_tokens",
        "image_output_tokens",
    ]
    tokens = {
        field: {
            "value": None,
            "evidence": "unknown",
            "scope": "observed_text",
            "completeness": "unknown",
            "profile_id": None,
            "reason": "provider_usage_unavailable",
        }
        for field in fields
    }
    tokens["answer_output"] = {
        "value": count,
        "evidence": "heuristic_estimate",
        "scope": "observed_text",
        "completeness": "complete_for_scope",
        "profile_id": "o200k-base-4.0.0-reference",
        "reason": "tokenizer_mapping_unverified",
    }
    tokens["output_total"] = compose_output_total(tokens)
    attempt = {
        "schema_version": "3.0.0",
        "kind": "attempt", "timing": None,
        "attempt_id": str(uuid4()),
        "request_id": request["request_id"],
        "revision": 1,
        "provider_attempt_key": None,
        "key_version": "1",
        "started_at": instant(now),
        "ended_at": instant(now),
        "state": "completed",
        "execution_evidence": "content_observed",
        "model_id": None,
        "model_evidence": "unknown",
        "tokens": tokens,
        "media": {"image_operations": [], "generated_images": [], "coverage_reasons": []},
        "generation": {"text_components": [], "media": []},
        "coverage_reasons": [],
        "tokenizer_profile_id": None,
        "tokenizer_asset_hash": None,
        "proposed_method_id": BASELINE_METHOD_ID,
        "company_dedup_key": None,
    }
    return request, attempt


def upload(client, credentials, records, epoch=0):
    return client.post(
        "/v1/usage/batches",
        headers={"Authorization": "Bearer " + credentials["access_token"]},
        json={
            "schema_version": "3.0.0",
            "batch_id": str(uuid4()),
            "sent_at": records[0].get("dispatched_at", records[0].get("started_at")),
            "client_version": "0.1.0",
            "deletion_epoch": epoch,
            "records": records,
        },
    )


def test_exact_once_revisions_decrease_and_scope_summary(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    first = upload(client, credentials, [request, attempt])
    assert first.status_code == 200, first.text
    assert [r["status"] for r in first.json()["results"]] == ["applied", "applied"]
    assert [r["status"] for r in upload(client, credentials, [request, attempt]).json()["results"]] == [
        "duplicate",
        "duplicate",
    ]
    correction = deepcopy(attempt)
    correction["revision"] = 2
    correction["tokens"]["answer_output"]["value"] = "200"
    recompose(correction)
    assert upload(client, credentials, [correction]).json()["results"][0]["status"] == "applied"
    assert upload(client, credentials, [attempt]).json()["results"][0]["status"] == "stale"
    summary = client.get("/v1/me/summary").json()
    assert summary["request_count"] == "1" and summary["attempt_count"] == "1"
    output = next(t for t in summary["tokens"] if t["quantity"] == "answer_output")
    assert output["value"] == "200"
    water = next(t for t in summary["resources"] if t["quantity"] == "water_total")
    assert water["value"] is None
    with app.state.db.transaction() as s:
        assert len(rows(s, "revision", company.id)) == 3


def test_missing_parent_conflict_clock_and_no_backfill(setup):
    app, client, _, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    assert upload(client, credentials, [attempt]).json()["results"][0]["error_code"] == "dependency_missing"
    old, _ = observations(now[0] - timedelta(days=1))
    assert upload(client, credentials, [old]).json()["results"][0]["error_code"] == "outside_enrollment_era"
    future, _ = observations(now[0] + timedelta(minutes=6))
    assert upload(client, credentials, [future]).json()["results"][0]["error_code"] == "clock_skew"
    assert upload(client, credentials, [request]).json()["results"][0]["status"] == "applied"
    request["state"] = "failed"
    assert upload(client, credentials, [request]).json()["results"][0]["status"] == "conflict"


def test_content_rejected_and_company_summary_shares_one_persons_values(setup):
    app, client, _, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    rejected = upload(client, credentials, [{**request, "prompt": "PRIVATE-CONTENT-MARKER"}])
    assert rejected.status_code == 200 and "PRIVATE-CONTENT-MARKER" not in rejected.text
    assert rejected.json()["results"][0]["status"] == "rejected"
    assert rejected.json()["results"][0]["payload_hash"] is None
    upload(client, credentials, [request, attempt])
    result = client.get("/v1/company/summary")
    assert result.json()["suppressed"] is False
    assert result.json()["request_count"] == "1" and result.json()["tokens"]
    assert "PRIVATE-CONTENT-MARKER" not in result.text
    assert client.get("/v1/company/summary?user_id=" + credentials["user_id"]).status_code == 422
    assert client.get("/v1/company/summary?device_id=x").status_code == 422


def test_duplicate_keys_alias_without_double_counting(setup):
    app, client, _, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, _ = observations(now[0])
    request["provider_request_key"] = "b" * 64
    upload(client, credentials, [request])
    duplicate = {**request, "request_id": str(uuid4())}
    ack = upload(client, credentials, [duplicate]).json()["results"][0]
    assert ack["status"] == "aliased" and ack["canonical_id"] == request["request_id"]
    assert client.get("/v1/me/summary").json()["request_count"] == "1"


@PERSON_ANALYTICS
def test_ip_observed_at_upload_encrypted_and_admin_only(setup):
    app, client, company, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    response = upload(client, credentials, [request, attempt])
    assert response.status_code == 200
    with app.state.db.transaction() as s:
        row = rows(s, "network", company.id)[0]
        assert row.data["source_quality"] == "ip_unresolved"
        assert row.data["accepted_record_count"] == 2
    member_client = __import__("fastapi.testclient", fromlist=["TestClient"]).TestClient(
        app, base_url=str(client.base_url)
    )
    member_client.headers["Origin"] = str(client.base_url).rstrip("/")
    member_login(app, member_client, "member@example.org")
    assert member_client.get("/v1/admin/network").status_code == 403


def test_delete_family_epoch_anti_resurrection_and_export_invalidation(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    upload(client, credentials, [request, attempt])
    exported = client.post("/v1/admin/exports", json=confirmed(client, {"period": "all", "format": "csv"}))
    assert exported.status_code == 200, exported.text
    download = exported.json()["download_path"]
    assert "text/csv" in client.get(download).headers["content-type"]
    preview = client.post(
        "/v1/admin/deletions/preview",
        json={
            "scope": "range",
            "start": instant(now[0] - timedelta(seconds=1)),
            "end": instant(now[0] + timedelta(seconds=1)),
        },
    )
    assert preview.status_code == 200, preview.text
    proof = token()
    with app.state.db.transaction() as s:
        put(
            s,
            "reauth",
            digest(proof),
            {"expires": app.state.service.expires(300), "used": False},
            company.id,
            admin.id,
        )
    deleted = client.post(
        "/v1/admin/deletions",
        json={
            "preview_token": preview.json()["preview_token"],
            "idempotency_key": str(uuid4()),
            "confirmed": True,
            "reauth_token": proof,
        },
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["records_erased"] == 2
    assert client.get(download).status_code == 404
    assert upload(client, credentials, [request]).status_code == 409
    request["request_id"] = str(uuid4())
    assert upload(client, credentials, [request], 1).json()["results"][0]["status"] == "erased"
    assert client.get("/v1/me/summary").json()["request_count"] == "0"
    changes = client.get("/v1/deletions/changes").json()
    assert changes["deletion_epoch"] == 1
    signed = client.post(
        "/v1/deletions/status",
        json={
            "device_id": credentials["device_id"],
            "credential": credentials["deletion_receipt_credential"],
            "last_epoch": 0,
        },
    ).json()
    pub = client.get("/v1/public/config").json()["deletion_public_key"]
    Ed25519PublicKey.from_public_bytes(base64.urlsafe_b64decode(pub + "==")).verify(
        base64.urlsafe_b64decode(signed["signature"] + "=="), canonical(signed["instruction"]).encode()
    )


@PERSON_ANALYTICS
def test_retention_clamped_calendar_and_network_purge(setup):
    app, client, company, admin, now, _ = setup
    with app.state.db.transaction() as s:
        cutoff = app.state.service.analytics.cutoff(s, get(s, "company", company.id))
        assert cutoff == "2026-03-09T23:00:00.000Z"
        put(
            s,
            "network",
            str(uuid4()),
            {
                "observed_at": instant(now[0] - timedelta(days=31)),
                "address": "encrypted",
                "equality": "key",
                "device_id": "fixture",
                "source_quality": "server_observed",
                "accepted_record_count": 1,
            },
            company.id,
            admin.id,
        )
        app.state.service.analytics.maintenance(s, get(s, "company", company.id))
        assert rows(s, "network", company.id) == []

def test_image_input_tokens_count_only_where_images_apply(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    priced = {
        "value": "1296",
        "evidence": "heuristic_estimate",
        "scope": "provider_defined_subset",
        "completeness": "complete_for_scope",
        "profile_id": "vendor-image-rules-1",
        "reason": "image_settings_unknown",
    }
    with_image = observations(now[0])
    with_image[0]["features"] = ["text", "image_input"]
    with_image[0]["media"]["input_images"] = [
        {
            "count": "1",
            "origin": "new_upload",
            "width": 1000,
            "height": 1000,
            "dimension_source": "unknown",
            "detail": "unknown",
            "token_profile_id": "vendor-image-rules-1",
            "tokens": priced,
        }
    ]
    with_image[1]["tokens"]["image_input_tokens"] = priced
    without = observations(now[0])
    without[1]["tokens"]["image_input_tokens"] = {
        "value": None,
        "evidence": "not_applicable",
        "scope": "provider_defined_subset",
        "completeness": "unknown",
        "profile_id": None,
        "reason": "not_applicable",
    }
    response = upload(client, credentials, [*with_image, *without])
    assert response.status_code == 200, response.text
    summary = client.get("/v1/me/summary").json()
    images = [t for t in summary["tokens"] if t["quantity"] == "image_input_tokens"]
    # A reply without uploaded images is neither a known nor an unknown image count.
    assert len(images) == 1
    assert images[0]["value"] == "1296"
    assert int(images[0]["unknown_count"]) == 0
    assert int(images[0]["applicable_count"]) == 1


def test_other_models_output_is_its_own_token_series(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    records = observations(now[0])
    records[1]["generation"]["text_components"] = [
        {
            "role": "side_calls",
            "model_id": None,
            "model_evidence": "unknown",
            "tokens": {
                "value": "10",
                "evidence": "provider_reported",
                "scope": "provider_request",
                "completeness": "complete_for_scope",
                "profile_id": None,
                "reason": None,
            },
            "timing": None,
        }
    ]
    response = upload(client, credentials, records)
    assert response.status_code == 200, response.text
    summary = client.get("/v1/me/summary").json()
    other = [t for t in summary["tokens"] if t["quantity"] == "other_model_output"]
    assert len(other) == 1
    assert other[0]["value"] == "10"
    assert int(other[0]["applicable_count"]) == 1


def test_read_aloud_adds_its_attempt_but_never_a_request(setup):
    """ChatGPT read aloud is speech made from a reply already counted (G1)."""
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    sent = observations(now[0])
    request, attempt = observations(now[0], count="0")
    request["action"] = "read_aloud"
    request["features"] = ["audio"]
    attempt["generation"]["media"] = [
        {"kind": "speech", "length_basis": "audio_frames", "seconds": "12.5", "characters": None}
    ]
    response = upload(client, credentials, [*sent, request, attempt])
    assert response.status_code == 200, response.text
    assert [r["status"] for r in response.json()["results"]] == ["applied"] * 4
    summary = client.get("/v1/me/summary").json()
    assert summary["request_count"] == "1"
    assert summary["attempt_count"] == "2"
    with app.state.db.transaction() as s:
        stored = [
            r
            for r in s.scalars(select(Observation).where(Observation.tenant == company.id))
            if r.kind == "request" and r.payload["action"] == "read_aloud"
        ]
        assert len(stored) == 1
    shared = client.get("/v1/company/summary").json()
    assert shared["request_count"] == "1" and shared["attempt_count"] == "2"


def test_notebook_guide_adds_its_attempt_but_never_a_request(setup):
    """A NotebookLM guide is text the page asks for itself when a source is added (W9)."""
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    sent = observations(now[0])
    request, attempt = observations(now[0], count="0")
    request["site"] = "notebooklm"
    request["action"] = "notebook_guide"
    attempt["tokens"]["intermediate_output"] = {
        "value": "120",
        "evidence": "heuristic_estimate",
        "scope": "observed_text",
        "completeness": "complete_for_scope",
        "profile_id": "o200k-base-4.0.0-reference",
        "reason": "tokenizer_mapping_unverified",
    }
    recompose(attempt)
    response = upload(client, credentials, [*sent, request, attempt])
    assert response.status_code == 200, response.text
    assert [r["status"] for r in response.json()["results"]] == ["applied"] * 4
    summary = client.get("/v1/me/summary").json()
    assert summary["request_count"] == "1"
    assert summary["attempt_count"] == "2"


def test_a_saved_guide_read_again_joins_the_first_without_a_conflict(setup):
    """NotebookLM reads a notebook's saved guide again when the notebook opens (5 Oct 2026).

    The browser names one guide request per notebook at its dispatch and each guide reply by
    its text, so a later read of a synced guide joins it, even when its dispatch was synced
    before its reply: one attempt counts and nothing is reported as a conflict.
    """
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)

    def read(text):
        # Each read is a later visit, as when the notebook opens again in a new page.
        now[0] += timedelta(minutes=2)
        request, attempt = observations(now[0], count="0")
        request.update(
            site="notebooklm",
            action="notebook_guide",
            conversation_key="c" * 64,
            provider_request_key="d" * 64,
        )
        attempt["provider_attempt_key"] = text * 64
        attempt["tokens"]["intermediate_output"] = {
            "value": "120",
            "evidence": "heuristic_estimate",
            "scope": "observed_text",
            "completeness": "complete_for_scope",
            "profile_id": "o200k-base-4.0.0-reference",
            "reason": "tokenizer_mapping_unverified",
        }
        recompose(attempt)
        return request, attempt

    def statuses(records):
        response = upload(client, credentials, records)
        assert response.status_code == 200, response.text
        return response.json()["results"]

    saved = read("e")
    assert [r["status"] for r in statuses(list(saved))] == ["applied"] * 2
    # The next read is synced once at its dispatch, before its reply is named.
    request, attempt = read("e")
    dispatched = {**request, "state": "dispatched", "ended_at": None}
    started = {
        **attempt,
        "state": "dispatch_only",
        "ended_at": None,
        "execution_evidence": "none",
        "provider_attempt_key": None,
    }
    first = statuses([dispatched, started])
    assert [r["status"] for r in first] == ["aliased", "applied"], first
    assert first[0]["canonical_id"] == saved[0]["request_id"]
    results = statuses([{**request, "revision": 2}, {**attempt, "revision": 2}])
    assert [r["status"] for r in results] == ["aliased", "aliased"], results
    assert results[1]["canonical_id"] == saved[1]["attempt_id"]
    # A new guide, written after a source is added, is another reply of the same request
    # and counts as well.
    assert [r["status"] for r in statuses(list(read("f")))] == ["aliased", "applied"]
    summary = client.get("/v1/me/summary").json()
    assert summary["request_count"] == "0"
    assert summary["attempt_count"] == "2"
    assert summary["unresolved_request_count"] == "0"
    written = [t for t in summary["tokens"] if t["quantity"] == "intermediate_output"]
    assert sum(int(t["value"]) for t in written) == 240


def test_a_live_reply_named_by_its_thoughts_takes_its_answer_key_once_finished(setup):
    # 14 Oct 2026: the extension named a ChatGPT reply that thought first by its thoughts while
    # it streamed and by its answer once the answer came. The server kept the first revision
    # with a key (1 output token) and refused the reply's finished revision (14 tokens).
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0], count="1")
    thinking = {**attempt, "state": "generating", "ended_at": None, "provider_attempt_key": "a" * 64}
    assert [r["status"] for r in upload(client, credentials, [request, thinking]).json()["results"]] == [
        "applied",
        "applied",
    ]

    def revision(number, state, key, count):
        changed = deepcopy(attempt)
        changed.update(revision=number, state=state, provider_attempt_key=key)
        if state == "generating":
            changed["ended_at"] = None
        changed["tokens"]["answer_output"]["value"] = count
        return recompose(changed)

    # A revision that is still unfinished cannot rename the reply.
    streaming = upload(client, credentials, [revision(2, "generating", "b" * 64, "5")]).json()["results"][0]
    assert (streaming["status"], streaming["error_code"]) == ("conflict", "immutable_identity")
    # The finished revision of the same reply, from the same installation, replaces the key.
    finished = upload(client, credentials, [revision(3, "completed", "b" * 64, "14")]).json()["results"][0]
    assert finished["status"] == "applied", finished
    summary = client.get("/v1/me/summary").json()
    assert summary["attempt_count"] == "1"
    assert next(t for t in summary["tokens"] if t["quantity"] == "answer_output")["value"] == "14"
    with app.state.db.transaction(readonly=True) as s:
        stored = s.get(Observation, (company.id, admin.id, "attempt", attempt["attempt_id"]))
        assert stored.stable_key == "b" * 64 and stored.revision == 3
    # Once a finished revision named the reply, its key never changes again.
    again = upload(client, credentials, [revision(4, "completed", "c" * 64, "14")]).json()["results"][0]
    assert (again["status"], again["error_code"]) == ("conflict", "immutable_identity")


def test_a_finished_revision_cannot_replace_a_key_on_another_installation_or_request(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    first, _ = connect(app, client)
    request, attempt = observations(now[0], count="1")
    thinking = {**attempt, "state": "generating", "ended_at": None, "provider_attempt_key": "a" * 64}
    assert [r["status"] for r in upload(client, first, [request, thinking]).json()["results"]] == [
        "applied",
        "applied",
    ]
    finished = recompose({**deepcopy(attempt), "revision": 2, "provider_attempt_key": "b" * 64})
    # Another installation of the same person may not rename the reply.
    second, _ = connect(app, client)
    other = upload(client, second, [finished]).json()["results"][0]
    assert (other["status"], other["error_code"]) == ("conflict", "ownership_conflict")
    # A finished revision that names another request is still refused.
    other_request, _ = observations(now[0], count="1")
    assert upload(client, first, [other_request]).json()["results"][0]["status"] == "applied"
    moved = {**finished, "request_id": other_request["request_id"]}
    result = upload(client, first, [moved]).json()["results"][0]
    assert (result["status"], result["error_code"]) == ("conflict", "immutable_identity")
    with app.state.db.transaction(readonly=True) as s:
        stored = s.get(Observation, (company.id, admin.id, "attempt", attempt["attempt_id"]))
        assert stored.stable_key == "a" * 64 and stored.revision == 1


def test_uploads_store_no_connection_address(setup):
    """Owner decision of 18 October 2026: with IP collection off (the default) no address is stored."""
    app, client, company, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    response = client.post(
        "/v1/usage/batches",
        headers={"Authorization": "Bearer " + credentials["access_token"], "X-Forwarded-For": "192.0.2.7"},
        json={
            "schema_version": "3.0.0",
            "batch_id": str(uuid4()),
            "sent_at": request["dispatched_at"],
            "client_version": "0.1.0",
            "deletion_epoch": 0,
            "records": [request, attempt],
        },
    )
    assert response.status_code == 200, response.text
    with app.state.db.transaction() as s:
        assert rows(s, "network", company.id) == []
    # The browser's last upload is still known for the Health counts.
    with app.state.db.transaction() as s:
        assert get(s, "device", credentials["device_id"], company.id).data["last_reporting_at"]
    member_client = __import__("fastapi.testclient", fromlist=["TestClient"]).TestClient(
        app, base_url=str(client.base_url)
    )
    member_client.headers["Origin"] = str(client.base_url).rstrip("/")
    member_login(app, member_client, "member@example.org")
    assert member_client.get("/v1/admin/health").status_code == 403


def test_retention_clamped_calendar_and_stored_addresses_kept_until_the_purge_command(setup):
    app, client, company, admin, now, _ = setup
    with app.state.db.transaction() as s:
        cutoff = app.state.service.analytics.cutoff(s, get(s, "company", company.id))
        assert cutoff == "2026-03-09T23:00:00.000Z"
        put(
            s,
            "network",
            str(uuid4()),
            {
                "observed_at": instant(now[0] - timedelta(days=31)),
                "address": "encrypted",
                "equality": "key",
                "device_id": "fixture",
                "source_quality": "server_observed",
                "accepted_record_count": 1,
            },
            company.id,
            admin.id,
        )
        app.state.service.analytics.maintenance(s, get(s, "company", company.id))
        # With IP collection off there is no retention period, so nothing deletes stored addresses
        # automatically; only the explicit purge command does, after the owner confirms
        # (test_admin_privacy).
        assert len(rows(s, "network", company.id)) == 1
