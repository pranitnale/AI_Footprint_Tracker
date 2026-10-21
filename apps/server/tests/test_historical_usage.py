from copy import deepcopy
from uuid import uuid4

import pytest
from conftest import PERSON_ANALYTICS, confirmed, connect, login, member_login
from footprint_contracts import compose_output_total, history_response_parts, not_applicable_measurement
from footprint_estimator import BASELINE_METHOD_HASH, BASELINE_METHOD_ID
from sqlalchemy import func, select

from aift.db import HistoryObservation, get, put
from aift.maintenance import run
from aift.security import instant


def message(now, key="a" * 64, role="response"):
    record = {
        "schema_version": "3.0.0",
        "kind": "history_message", "timing": None,
        "message_key": key,
        "role": role,
        "conversation_key": "b" * 64,
        "key_version": "1",
        "site": "perplexity",
        "parent_key": None,
        "prompt_key": None,
        "provider_request_key": None,
        "provider_attempt_key": None,
        "occurred_at": "2020-01-01T10:00:00.000001Z",
        "date_basis": "entry_created",
        "observed_at": instant(now),
        "model_id": None,
        "proposed_method_id": BASELINE_METHOD_ID,
        "proposed_method_hash": BASELINE_METHOD_HASH,
        "tokens": {
            "value": "33",
            "evidence": "heuristic_estimate",
            "scope": "observed_text",
            "completeness": "complete_for_scope",
            "profile_id": "o200k-base-4.0.0-reference",
            "reason": "tokenizer_mapping_unverified",
        },
        "inline_file_text": None,
        "parts": None,
        "generation": {"text_components": [], "media": []},
        "text_complete": True,
        "coverage_reasons": ["history_only"],
        "company_dedup_key": None,
    }
    if role == "response":
        record["parts"] = history_response_parts(record["tokens"])
    return record


def with_answer(record, **answer):
    """A copy of a saved reply whose answer changed; its total stays its parts' sum."""
    parts = {**record["parts"], "answer_output": {**record["parts"]["answer_output"], **answer}}
    return {**record, "parts": parts, "tokens": compose_output_total(parts)}


def page(now, records=None, epoch=0):
    return {
        "schema_version": "3.0.0",
        "site": "perplexity",
        "conversation_key": "b" * 64,
        "observed_at": instant(now),
        "deletion_epoch": epoch,
        "messages": records if records is not None else [message(now)],
        "branch_scope": "loaded_messages",
        "selected_leaf_key": None,
        "branch_message_keys": None,
        "root_message_key": None,
        "first_request_verified": False,
        "has_earlier": None,
        "has_later": None,
    }


def paired(setup):
    app, client, company, member, now, settings = setup
    login(app, client)
    credentials, _ = connect(app, client)
    return app, client, company, member, now, credentials


def auth(c):
    return {"Authorization": "Bearer " + c["access_token"]}


def send(client, c, p):
    return client.post("/v1/me/history", headers=auth(c), json=p)


def summary(client, c):
    response = client.get("/v1/me/history/" + "b" * 64 + "/summary?period=all", headers=auth(c))
    assert response.status_code == 200, response.text
    return response.json()["history"]


def test_old_history_real_api_sync_dates_resources_and_cross_installation_dedup(setup):
    app, client, company, member, now, c = paired(setup)
    body = page(now[0], [message(now[0], "a" * 64, "prompt"), message(now[0], "c" * 64)])
    before = client.get("/v1/me/summary?period=all", headers=auth(c)).json()
    result = send(client, c, body)
    assert result.status_code == 200, result.text
    assert [r["status"] for r in result.json()["results"]] == ["applied", "applied"]
    other, _ = connect(app, client)
    assert [r["status"] for r in send(client, other, body).json()["results"]] == ["duplicate", "duplicate"]
    totals = summary(client, c)
    assert totals["prompt_count"] == "1"
    assert totals["response_count"] == "1"
    assert totals["dated_message_count"] == "2"
    rows = {(t["role"], t["part"]): t for t in totals["tokens"]}
    assert rows[("prompt", "total")]["value"] == rows[("response", "total")]["value"] == "33"
    # The page did not show the prompt's uploads, so its images stay unknown, never zero.
    assert rows[("prompt", "image_input_tokens")]["value"] is None
    assert rows[("prompt", "image_input_tokens")]["unknown_message_count"] == "1"
    assert len(rows) == 3
    assert next(r for r in totals["resources"] if r["quantity"] == "energy")["value"] is not None
    after = client.get("/v1/me/summary?period=all", headers=auth(c)).json()
    for key in ("request_count", "attempt_count", "tokens", "resources"):
        assert after[key] == before[key]
    run(app.state.service)
    assert summary(client, c)["response_count"] == "1"
    exported = client.get("/v1/me/history/export", headers=auth(c)).json()["records"]
    assert len(exported) == 2
    assert exported[0]["observation"]["occurred_at"] == "2020-01-01T10:00:00.000001Z"
    assert exported[0]["observation"]["date_basis"] == "entry_created"
    with app.state.db.transaction(readonly=True) as s:
        assert s.scalar(select(func.count()).select_from(HistoryObservation)) == 2


def test_history_token_rows_keep_images_and_tool_results_apart_from_message_totals(setup):
    app, client, company, member, now, c = paired(setup)
    counted = {
        "value": "1120",
        "evidence": "heuristic_estimate",
        "scope": "provider_defined_subset",
        "completeness": "complete_for_scope",
        "profile_id": "vendor-image-rules-1",
        "reason": "image_settings_unknown",
    }
    prompt = message(now[0], "a" * 64, "prompt")
    prompt["parts"] = {
        **{name: not_applicable_measurement() for name in history_response_parts(prompt["tokens"])},
        "image_input_tokens": counted,
    }
    reply = message(now[0], "c" * 64)
    tool = {**reply["tokens"], "value": "40"}
    reply["parts"] = history_response_parts(reply["tokens"], tool_output=tool)
    result = send(client, c, page(now[0], [prompt, reply]))
    assert [r["status"] for r in result.json()["results"]] == ["applied", "applied"], result.text
    rows = {(t["role"], t["part"]): t for t in summary(client, c)["tokens"]}
    assert set(rows) == {
        ("prompt", "total"),
        ("prompt", "image_input_tokens"),
        ("response", "total"),
        ("response", "tool_output"),
    }
    assert rows[("prompt", "total")]["value"] == "33"
    assert rows[("prompt", "image_input_tokens")]["value"] == "1120"
    assert rows[("prompt", "image_input_tokens")]["profile_id"] == "vendor-image-rules-1"
    assert rows[("response", "total")]["value"] == "33"
    assert rows[("response", "tool_output")]["value"] == "40"


def test_history_token_rows_add_other_models_output_apart_from_reply_totals(setup):
    app, client, company, member, now, c = paired(setup)
    reply = message(now[0], "c" * 64)
    reply["generation"] = {
        "text_components": [
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
        ],
        "media": [],
    }
    result = send(client, c, page(now[0], [reply]))
    assert [r["status"] for r in result.json()["results"]] == ["applied"], result.text
    rows = {(t["role"], t["part"]): t for t in summary(client, c)["tokens"]}
    assert rows[("response", "total")]["value"] == "33"
    assert rows[("response", "other_models")]["value"] == "10"
    assert rows[("response", "other_models")]["evidence"] == "provider_reported"


def test_unknown_dates_remain_unknown_and_explicit_erasure_prevents_reopen(setup):
    app, client, company, member, now, c = paired(setup)
    m = message(now[0])
    m["occurred_at"] = None
    m["date_basis"] = "unknown"
    assert send(client, c, page(now[0], [m])).status_code == 200
    assert summary(client, c)["undated_message_count"] == "1"
    with app.state.db.transaction(scope=company.id) as s:
        tenant = get(s, "company", company.id)
        marker = {
            "scope": "range",
            "user_id": member.id,
            "start": "2019-01-01T00:00:00.000Z",
            "end": "2021-01-01T00:00:00.000Z",
            "epoch": 1,
            "created_at": instant(now[0]),
            "record_ids": [],
            "record_owners": {},
            "job_id": str(uuid4()),
        }
        app.state.service.analytics.journal(company.id, marker)
        put(s, "deletion", marker["job_id"], marker, company.id, member.id)
        tenant.data = {**tenant.data, "epoch": 1}
        app.state.service.analytics.deletions.schedule_marker(s, tenant, marker)
    for _ in range(10):
        run(app.state.service)
    assert summary(client, c)["response_count"] == "0"
    answer = send(client, c, page(now[0], [m], 1))
    assert answer.status_code == 200, answer.text
    assert answer.json()["results"][0]["status"] == "erased"
    m["occurred_at"] = "2025-01-01T00:00:00.000Z"
    m["date_basis"] = "entry_created"
    assert send(client, c, page(now[0], [m], 1)).json()["results"][0]["status"] == "erased"


@pytest.mark.parametrize(
    "mutation",
    [
        lambda p: p["messages"][0].update(text="MUST_NOT_PERSIST"),
        lambda p: p["messages"][0].update(date_basis="unknown"),
        lambda p: p["messages"][0]["tokens"].update(value="1e3"),
        lambda p: p["messages"][0].update(proposed_method_hash="0" * 64),
        lambda p: p["messages"].append(deepcopy(p["messages"][0])),
    ],
)
def test_history_strict_rejection_has_no_partial_rows(setup, mutation):
    app, client, company, member, now, c = paired(setup)
    body = page(now[0])
    mutation(body)
    assert send(client, c, body).status_code in (400, 409, 422)
    with app.state.db.transaction(readonly=True) as s:
        assert s.scalar(select(func.count()).select_from(HistoryObservation)) == 0


def test_conflicting_counts_do_not_replace_original_history_or_resources(setup):
    app, client, company, member, now, c = paired(setup)
    body = page(now[0])
    assert send(client, c, body).status_code == 200
    with app.state.db.transaction(readonly=True) as s:
        row = s.scalar(select(HistoryObservation))
        original = deepcopy(row.original)
        assessment = deepcopy(row.original_estimate)
    # A count from another counting profile is a different measurement, not a newer state.
    body["messages"][0]["tokens"].update(value="99", profile_id="cl100k-base-4.0.0-reference")
    result = send(client, c, body)
    assert result.json()["results"][0]["status"] == "conflict"
    totals = summary(client, c)
    assert totals["conflicting_message_count"] == "1"
    assert totals["tokens"] == []
    with app.state.db.transaction(readonly=True) as s:
        row = s.scalar(select(HistoryObservation))
        assert row.original == original
        assert row.original_estimate == assessment


def test_grown_complete_reply_replaces_the_shorter_history_count(setup):
    app, client, company, member, now, c = paired(setup)
    body = page(now[0])
    assert send(client, c, body).status_code == 200
    # A shorter saved reread keeps the stored count.
    body["messages"][0]["tokens"]["value"] = "21"
    assert send(client, c, body).json()["results"][0]["status"] == "duplicate"
    body["messages"][0]["tokens"]["value"] = "99"
    result = send(client, c, body)
    assert result.json()["results"][0]["status"] == "applied"
    with app.state.db.transaction(readonly=True) as s:
        row = s.scalar(select(HistoryObservation))
        # The current record carries the grown count; the original view keeps the first receipt.
        assert row.status == "current" and row.payload["tokens"]["value"] == "99"
        assert row.original["tokens"]["value"] == "33"
    assert summary(client, c)["conflicting_message_count"] == "0"
    body["messages"][0]["tokens"]["value"] = "21"
    assert send(client, c, body).json()["results"][0]["status"] == "duplicate"


def test_a_reread_that_could_not_count_keeps_the_saved_count(setup):
    # A browser whose tokenizer failed on a reread sends unknown counts; the saved count
    # stays and the message is not a conflict (5 October 2026).
    app, client, company, member, now, c = paired(setup)
    body = page(now[0])
    assert send(client, c, body).status_code == 200
    failed = {
        "value": None,
        "evidence": "unknown",
        "scope": "observed_text",
        "completeness": "unknown",
        "profile_id": None,
        "reason": "tokenizer_unavailable",
    }
    body["messages"][0].update(tokens=failed, parts=history_response_parts(failed))
    result = send(client, c, body)
    assert result.status_code == 200, result.text
    assert result.json()["results"][0]["status"] == "duplicate"
    totals = summary(client, c)
    assert totals["conflicting_message_count"] == "0"
    with app.state.db.transaction(readonly=True) as s:
        row = s.scalar(select(HistoryObservation))
        assert row.status == "current" and row.payload["tokens"]["value"] == "33"


def test_history_auth_scope_import_time_and_unknown_date_filters(setup):
    from datetime import timedelta

    from fastapi.testclient import TestClient

    app, client, company, member, now, c = paired(setup)
    body = page(now[0])
    body["messages"][0]["occurred_at"] = None
    body["messages"][0]["date_basis"] = "unknown"
    assert send(client, c, body).status_code == 200
    outside = page(now[0], [message(now[0], "c" * 64)])
    outside["messages"][0]["observed_at"] = instant(now[0] - timedelta(hours=1))
    assert send(client, c, outside).status_code == 409
    unknown = client.get("/v1/me/summary?period=custom&start=2020-01-01&end=2020-01-02", headers=auth(c))
    assert unknown.status_code == 200, unknown.text
    assert unknown.json()["history"]["undated_message_count"] == "0"
    employee = TestClient(app, base_url=company.origin)
    employee.headers["Origin"] = company.origin
    member_login(app, employee, "another@example.org")
    other, _ = connect(app, employee)
    assert summary(employee, other)["observed_response_count"] == "0"
    assert send(employee, other, page(now[0])).status_code == 200
    assert summary(employee, other)["dated_message_count"] == "1"
    assert summary(client, c)["undated_message_count"] == "1"
    assert client.get("/v1/me/history/export").status_code == 403
    anonymous = TestClient(app, base_url=company.origin)
    anonymous.headers["Origin"] = company.origin
    assert anonymous.post("/v1/me/history", json=body).status_code == 401
    with app.state.db.transaction(scope=company.id) as session:
        device = get(session, "device", c["device_id"], company.id)
        device.data = {**device.data, "status": "revoked"}
    assert send(client, c, body).status_code in (401, 403)
    employee.close()
    anonymous.close()


def test_history_pages_over100_branch_selection_and_source_precision(setup):
    app, client, company, member, now, c = paired(setup)
    records = []
    for i in range(220):
        m = message(now[0], f"{i + 1:064x}", "prompt" if i % 2 == 0 else "response")
        m["parent_key"] = f"{i:064x}" if i else None
        m["prompt_key"] = f"{i if i % 2 else i + 1:064x}"
        m["occurred_at"] = "2020-01-01T00:00:00.000001Z" if i < 2 else "2020-02-01T00:00:00.000Z"
        records.append(m)
    for offset in range(0, len(records), 100):
        body = page(now[0], records[offset : offset + 100])
        body.update(
            branch_scope="selected_branch",
            selected_leaf_key=records[-1]["message_key"],
            root_message_key=records[0]["message_key"],
            first_request_verified=offset + 100 >= len(records),
        )
        assert send(client, c, body).status_code == 200
    total = summary(client, c)
    assert total["observed_prompt_count"] == "110"
    assert total["first_request_verified"] is True
    with app.state.db.transaction(readonly=True) as session:
        tenant = get(session, "company", company.id)
        ranged = app.state.service.analytics.history.summary(
            session,
            tenant,
            c["user_id"],
            "b" * 64,
            {"period": "custom", "start": "2020-01-01", "end": "2020-01-02"},
        )
        assert ranged["observed_prompt_count"] == "1" and ranged["observed_response_count"] == "1"
    shorter = page(now[0], [])
    shorter.update(
        branch_scope="selected_branch",
        selected_leaf_key=records[1]["message_key"],
        root_message_key=records[0]["message_key"],
        first_request_verified=True,
    )
    assert send(client, c, shorter).status_code == 200
    assert summary(client, c)["observed_response_count"] == "1"


def test_history_live_match_exclusion_and_age_cleanup_preserves_imported_assessment(setup):
    from datetime import timedelta

    from test_file_text_contract import mixed_upload
    from test_perplexity_identity import records_for, statuses

    app, client, company, member, now, c = paired(setup)
    request, attempt = records_for(c, now[0], str(uuid4()), str(uuid4()))
    assert statuses(mixed_upload(client, c, [request, attempt])) == ["applied", "applied"]
    prompt = message(now[0], "a" * 64, "prompt")
    prompt["provider_request_key"] = request["provider_request_key"]
    answer = message(now[0], "c" * 64)
    answer["provider_attempt_key"] = attempt["provider_attempt_key"]
    answer["provider_request_key"] = request["provider_request_key"]
    assert send(client, c, page(now[0], [prompt, answer])).status_code == 200
    totals = summary(client, c)
    assert totals["observed_prompt_count"] == "1"
    assert totals["matched_live_message_count"] == "2"
    assert totals["prompt_count"] == "0"
    assert totals["resources"] == []
    with app.state.db.transaction(readonly=True) as session:
        before = [deepcopy(r.estimate) for r in session.scalars(select(HistoryObservation))]
    now[0] += timedelta(days=220)
    for _ in range(20):
        run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        rows = list(session.scalars(select(HistoryObservation)))
        assert len(rows) == 2
        assert [r.estimate for r in rows] == before
        tenant = get(session, "company", company.id)
        after = app.state.service.analytics.history.summary(session, tenant, c["user_id"], "b" * 64)
        assert after["observed_response_count"] == "1" and after["response_count"] == "1"


def test_history_company_summary_shares_one_persons_messages(setup):
    from fastapi.testclient import TestClient

    app, client, company, member, now, c = paired(setup)
    from test_file_text_contract import mixed_upload
    from test_perplexity_identity import records_for, statuses

    for i in range(6):
        employee = TestClient(app, base_url=company.origin)
        employee.headers["Origin"] = company.origin
        member_login(app, employee, f"person{i}@example.org")
        credentials, _ = connect(app, employee)
        assert statuses(
            mixed_upload(
                employee, credentials, list(records_for(credentials, now[0], str(uuid4()), str(uuid4())))
            )
        ) == ["applied", "applied"]
        m = message(now[0], role="response" if i < 5 else "prompt")
        assert send(employee, credentials, page(now[0], [m])).status_code == 200
        employee.close()
    response = client.get("/v1/company/summary?period=all", headers=auth(c))
    assert response.status_code == 200, response.text
    # One person's saved prompt shows to members as well (owner decision of 13 October 2026).
    history = response.json()["history"]
    assert history["status"] == "available", history
    assert history["observed_response_count"] == "5" and history["observed_prompt_count"] == "1"
    admin = client.get("/v1/admin/summary?period=all")
    assert admin.status_code == 200
    assert admin.json()["history"] == history


def test_standard_summary_csv_omits_empty_historical_projection(setup):
    import csv
    import io

    _, client, _, _, _, _ = paired(setup)
    exported = client.post("/v1/admin/exports", json=confirmed(client, {"report": "summary", "period": "all"}))
    assert exported.status_code == 200, exported.text
    downloaded = client.get(exported.json()["download_path"])
    assert downloaded.status_code == 200, downloaded.text
    rows = list(csv.DictReader(io.StringIO(downloaded.text)))
    assert rows
    assert not any(
        row["scope"] in {"loaded_history", "historical_visible_text", "historical_visible_response"}
        for row in rows
    )


def test_recalculated_summary_csv_waits_for_new_history_and_retains_originals(setup):
    import csv
    import io

    from test_method_history import begin, install_bundle

    app, client, _, _, now, _, credentials, _ = begin(setup)
    bundle = install_bundle(app, now[0])
    options = {"calculation_view": "recalculated", "method_id": bundle["method_id"]}
    created = client.post(
        "/v1/admin/recalculations", json={"method_id": bundle["method_id"], "operation_id": str(uuid4())}
    )
    assert created.status_code == 200, created.text
    run(app.state.service)
    assert client.get("/v1/admin/recalculations/" + created.json()["job_id"]).json()["status"] == "completed"
    assert send(client, credentials, page(now[0])).status_code == 200

    exported = client.post(
        "/v1/admin/exports", json=confirmed(client, {**options, "report": "summary", "period": "all"})
    )
    assert exported.status_code == 409 and exported.json()["error"]["code"] == "recalculation_pending"
    run(app.state.service)
    exported = client.post(
        "/v1/admin/exports", json=confirmed(client, {**options, "report": "summary", "period": "all"})
    )
    assert exported.status_code == 200, exported.text
    downloaded = client.get(exported.json()["download_path"])
    assert downloaded.status_code == 200, downloaded.text
    rows = list(csv.DictReader(io.StringIO(downloaded.text)))
    history_rows = [
        row
        for row in rows
        if row["scope"] in {"loaded_history", "historical_visible_text", "historical_visible_response"}
    ]
    live_rows = [row for row in rows if row not in history_rows]

    assert history_rows and live_rows
    assert all(row["calculation_view"] == "recalculated" for row in history_rows)
    assert all(row["calculation_view"] == "recalculated" for row in live_rows)
    assert {"historical_observed_response_count", "historical_response_tokens", "energy"} <= {
        row["quantity"] for row in history_rows
    }
    count_row = next(row for row in history_rows if row["quantity"] == "historical_observed_response_count")
    assert count_row["method_id"] == count_row["method_hash"] == ""
    token_row = next(row for row in history_rows if row["quantity"] == "historical_response_tokens")
    assert token_row["measurement_group"] == (
        '{"evidence":"heuristic_estimate","profile_id":"o200k-base-4.0.0-reference"}'
    )
    assert token_row["method_id"] == token_row["method_hash"] == ""
    energy_row = next(row for row in history_rows if row["quantity"] == "energy")
    from footprint_contracts import payload_hash

    assert energy_row["method_id"] == bundle["method_id"]
    assert energy_row["method_hash"] == payload_hash(bundle)
    assert energy_row["selected_profile_id"]
    assert any(row["method_id"] == bundle["method_id"] for row in live_rows)


@PERSON_ANALYTICS
def test_history_backup_replay_preview_and_standard_csv_export(setup, tmp_path):
    import csv
    import io
    import shutil
    import sqlite3

    from test_completion import finish_job, reauth

    from aift.main import create_app
    from tools.verify_restore import verify_restored

    app, client, company, member, now, c = paired(setup)
    known = message(now[0])
    unknown = message(now[0], "c" * 64, "prompt")
    unknown["occurred_at"] = None
    unknown["date_basis"] = "unknown"
    assert send(client, c, page(now[0], [known, unknown])).status_code == 200
    exported = client.post(
        "/v1/admin/exports",
        json=confirmed(client, {"report": "records", "period": "all", "calculation_view": "original"}),
    )
    assert exported.status_code == 200, exported.text
    job = exported.json()
    job_id = job["export_id"] if "export_id" in job else job["job_id"]
    for _ in range(5):
        if job["status"] == "completed":
            break
        job = client.post(f"/v1/admin/exports/{job_id}/advance", json={}).json()
    with app.state.db.transaction(readonly=True) as session:
        export = get(session, "export", job_id, company.id)
        # The record report names a person on every row, so it leaves out the undated message:
        # its only time comes from the browser and cannot show it was saved while person
        # analytics was on (test_admin_privacy).
        assert export.data["row_count"] == 1
    downloaded = client.get(f"/v1/admin/exports/{job_id}/download")
    assert downloaded.status_code == 200, downloaded.text
    rows = list(csv.DictReader(io.StringIO(downloaded.text)))
    assert len(rows) == 1
    assert {r["record_kind"] for r in rows} == {"history_message"}
    assert {r["date_basis"] for r in rows} == {"entry_created"}
    assert all(r["calculation_view"] == "original" and r["original_estimate_json"] for r in rows)
    database = app.state.db.engine.url.database
    backup = tmp_path / "history-before-erasure.db"
    with sqlite3.connect(database) as source, sqlite3.connect(backup) as target:
        source.backup(target)
    preview = client.post(
        "/v1/admin/deletions/preview",
        json={"scope": "range", "start": "2019-01-01T00:00:00.000Z", "end": "2021-01-01T00:00:00.000Z"},
    ).json()
    assert preview["historical_message_count"] == "2"
    assert preview["undated_historical_message_count"] == "1"
    operation = str(uuid4())
    response = client.post(
        "/v1/admin/deletions",
        json={
            "preview_token": preview["preview_token"],
            "idempotency_key": operation,
            "confirmed": True,
            "reauth_token": reauth(app, company, member),
        },
    )
    assert response.status_code == 200, response.text
    finish_job(app, company, operation)
    app.state.db.engine.dispose()
    shutil.copyfile(backup, database)
    restored = create_app(setup[-1], clock=lambda: now[0])
    assert verify_restored(restored.state.service)["status"] == "passed"
    with restored.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(HistoryObservation)) == 0


def test_history_erasure_compares_source_microseconds_before_and_after_cleanup(setup):
    app, client, company, member, now, c = paired(setup)
    records = [message(now[0], f"{i + 1:064x}") for i in range(4)]
    for record, fraction in zip(records, ("000000", "000001", "000999", "001000"), strict=True):
        record["occurred_at"] = "2020-01-01T00:00:00." + fraction + "Z"
    assert send(client, c, page(now[0], records)).status_code == 200
    marker = {
        "scope": "range",
        "user_id": member.id,
        "start": "2020-01-01T00:00:00.000Z",
        "end": "2020-01-01T00:00:00.001Z",
        "epoch": 1,
        "created_at": instant(now[0]),
        "record_ids": [],
        "record_owners": {},
        "job_id": str(uuid4()),
    }
    with app.state.db.transaction(scope=company.id) as session:
        tenant = get(session, "company", company.id)
        put(session, "deletion", marker["job_id"], marker, company.id, member.id)
        history = app.state.service.analytics.history
        visible = list(session.scalars(select(HistoryObservation).where(history.visible(tenant))))
        assert [row.message_key for row in visible] == [records[3]["message_key"]]
        assert history.erase_page(session, tenant, marker) == 3
        assert [history.erased(session, tenant, member.id, record) for record in records] == [
            True,
            True,
            True,
            False,
        ]
        records[1]["occurred_at"] = "2025-01-01T00:00:00.000Z"
        assert history.erased(session, tenant, member.id, records[1]) is True


def test_studio_rows_count_without_waiting_for_a_live_match(setup):
    """NotebookLM Studio items have no live request, so they never show unverified matching (W9)."""
    app, client, company, member, now, c = paired(setup)
    studio = []
    for key, role in (("d" * 64, "prompt"), ("e" * 64, "response")):
        record = message(now[0], key, role)
        record["site"] = "notebooklm"
        record["coverage_reasons"] = ["history_only", "no_live_request"]
        studio.append(record)
    body = {**page(now[0], studio), "site": "notebooklm"}
    result = send(client, c, body)
    assert result.status_code == 200, result.text
    assert [r["status"] for r in result.json()["results"]] == ["applied", "applied"]
    totals = summary(client, c)
    assert totals["prompt_count"] == "1"
    assert totals["response_count"] == "1"
    assert totals["unresolved_overlap_message_count"] == "0"
    assert totals["matched_live_message_count"] == "0"


def test_a_regenerated_claude_reply_counts_one_request(setup):
    """A claude.ai reply after the first to the same prompt was a retry_completion: one request
    of its own, as in the extension (regeneratedHistoryReplies)."""
    app, client, company, member, now, c = paired(setup)
    prompt = message(now[0], "d" * 64, "prompt")
    replies = []
    for key, attempt, day in (("e" * 64, "1" * 64, "01"), ("f" * 64, "2" * 64, "02")):
        record = message(now[0], key)
        record.update(
            parent_key=prompt["message_key"],
            prompt_key=prompt["message_key"],
            provider_attempt_key=attempt,
            occurred_at=f"2020-01-{day}T10:00:00.000001Z",
        )
        replies.append(record)
    records = [prompt, *replies]
    for record in records:
        record["site"] = "claude"
    result = send(client, c, {**page(now[0], records), "site": "claude"})
    assert result.status_code == 200, result.text
    totals = summary(client, c)
    assert totals["observed_prompt_count"] == "1"
    assert totals["prompt_count"] == "2"
    assert totals["response_count"] == "2"
    # A period holding only the regeneration still counts its request: the reply it
    # replaced is looked for among every saved row of the chat.
    day = client.get("/v1/me/summary?period=custom&start=2020-01-02&end=2020-01-03", headers=auth(c))
    assert day.status_code == 200, day.text
    assert day.json()["history"]["response_count"] == "1"
    assert day.json()["history"]["prompt_count"] == "1"


@PERSON_ANALYTICS
def test_a_browser_that_only_uploaded_saved_messages_has_a_last_upload(setup):
    # 14 Oct 2026: a browser that had synced only saved history showed "Never" on the Health page,
    # because only usage batches set the last upload time.
    app, client, company, member, now, c = paired(setup)

    def browser():
        return next(b for b in client.get("/v1/admin/health").json()["browsers"] if b["user_id"] == member.id)

    assert browser()["last_reporting_at"] is None
    result = send(client, c, page(now[0], [message(now[0], "a" * 64, "prompt"), message(now[0], "c" * 64)]))
    assert result.status_code == 200, result.text
    assert browser()["last_reporting_at"] == instant(now[0])


def test_history_backup_replay_preview_and_summary_csv_export_without_person_analytics(setup, tmp_path):
    import csv
    import io
    import shutil
    import sqlite3

    from test_completion import finish_job, reauth

    from aift.main import create_app
    from tools.verify_restore import verify_restored

    app, client, company, member, now, c = paired(setup)
    known = message(now[0])
    unknown = message(now[0], "c" * 64, "prompt")
    unknown["occurred_at"] = None
    unknown["date_basis"] = "unknown"
    assert send(client, c, page(now[0], [known, unknown])).status_code == 200
    exported = client.post(
        "/v1/admin/exports",
        json=confirmed(client, {"report": "summary", "period": "all", "calculation_view": "original"}),
    )
    assert exported.status_code == 200, exported.text
    job = exported.json()
    assert job["status"] == "completed"
    downloaded = client.get(job["download_path"])
    assert downloaded.status_code == 200, downloaded.text
    rows = list(csv.DictReader(io.StringIO(downloaded.text)))
    counts = {r["quantity"]: r["value"] for r in rows if r["scope"] == "loaded_history"}
    # Both saved messages count for all time, the undated one included.
    assert counts and all(r["calculation_view"] == "original" for r in rows)
    assert member.id not in downloaded.text
    database = app.state.db.engine.url.database
    backup = tmp_path / "history-before-erasure.db"
    with sqlite3.connect(database) as source, sqlite3.connect(backup) as target:
        source.backup(target)
    preview = client.post(
        "/v1/admin/deletions/preview",
        json={"scope": "range", "start": "2019-01-01T00:00:00.000Z", "end": "2021-01-01T00:00:00.000Z"},
    ).json()
    assert preview["historical_message_count"] == "2"
    assert preview["undated_historical_message_count"] == "1"
    operation = str(uuid4())
    response = client.post(
        "/v1/admin/deletions",
        json={
            "preview_token": preview["preview_token"],
            "idempotency_key": operation,
            "confirmed": True,
            "reauth_token": reauth(app, company, member),
        },
    )
    assert response.status_code == 200, response.text
    finish_job(app, company, operation)
    app.state.db.engine.dispose()
    shutil.copyfile(backup, database)
    restored = create_app(setup[-1], clock=lambda: now[0])
    assert verify_restored(restored.state.service)["status"] == "passed"
    with restored.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(HistoryObservation)) == 0


def test_a_browser_that_only_uploaded_saved_messages_counts_as_synced(setup):
    # 14 Oct 2026: a browser that had synced only saved history showed "Never" on the Health page,
    # because only usage batches set the last upload time. The page shows counts only since 18 Oct.
    app, client, company, member, now, c = paired(setup)

    def synced():
        return client.get("/v1/admin/health").json()["browsers_synced_last_day"]

    assert synced() == 0
    result = send(client, c, page(now[0], [message(now[0], "a" * 64, "prompt"), message(now[0], "c" * 64)]))
    assert result.status_code == 200, result.text
    assert synced() == 1
    with app.state.db.transaction(readonly=True) as session:
        assert get(session, "device", c["device_id"], company.id).data["last_reporting_at"] == instant(now[0])
