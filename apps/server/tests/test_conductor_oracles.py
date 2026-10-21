"""Conductor-owned independent behavioral checks for implementation review."""

import logging

from conftest import PERSON_ANALYTICS, connect, login, member_login
from fastapi.testclient import TestClient
from test_analytics import observations, upload

from aift.db import get


@PERSON_ANALYTICS
def test_equal_request_ids_in_different_users_never_combine_attempt_counts(setup):
    app, admin_client, company, _admin, clock, _settings = setup
    login(app, admin_client)
    admin_credentials, _ = connect(app, admin_client)
    first_request, first_attempt = observations(clock[0])
    assert upload(admin_client, admin_credentials, [first_request, first_attempt]).status_code == 200

    with TestClient(app, base_url=company.data["origin"]) as member_client:
        member_client.headers["Origin"] = company.data["origin"]
        member_login(app, member_client, "member@example.org")
        member_credentials, _ = connect(app, member_client)
        second_request, second_attempt = observations(clock[0])
        second_request["request_id"] = first_request["request_id"]
        second_attempt["request_id"] = first_request["request_id"]
        result = upload(member_client, member_credentials, [second_request, second_attempt])
        assert result.status_code == 200
        assert [item["status"] for item in result.json()["results"]] == ["applied", "applied"]

    response = admin_client.get("/v1/admin/requests?period=all")
    assert response.status_code == 200
    requests = response.json()["items"]
    assert len(requests) == 2
    assert len({item["user_id"] for item in requests}) == 2
    assert [item["attempt_count"] for item in requests] == ["1", "1"]


def test_internal_failures_have_actionable_correlation_without_exception_content(setup, monkeypatch, caplog):
    app, client, _company, _admin, _clock, _settings = setup
    marker = "SYNTHETIC_PRIVATE_EXCEPTION_CONTENT"

    def programming_failure(*_args, **_kwargs):
        raise TypeError(marker)

    monkeypatch.setattr(app.state.service, "handle", programming_failure)
    caplog.set_level(logging.ERROR)
    response = client.get("/v1/public/config")
    assert response.status_code == 500
    problem = response.json()["error"]
    assert problem["code"] == "internal_error"
    assert marker not in response.text
    assert marker not in caplog.text
    with app.state.db.transaction(readonly=True) as session:
        diagnostic = get(session, "diagnostic", problem["correlation_id"])
        assert diagnostic is not None
        assert diagnostic.data["correlation_id"] == problem["correlation_id"]
        assert diagnostic.data["exception_class"] == "TypeError"
        assert set(diagnostic.data) == {"correlation_id", "category", "exception_class", "at"}
        assert marker not in str(diagnostic.data)


def test_database_failure_still_has_safe_correlated_fallback_diagnostic(setup, monkeypatch, caplog):
    app, client, _company, _admin, _clock, _settings = setup
    marker = "SYNTHETIC_PRIVATE_DATABASE_CONTENT"

    def database_failure(*_args, **_kwargs):
        raise OSError(marker)

    monkeypatch.setattr(app.state.db, "transaction", database_failure)
    caplog.set_level(logging.ERROR)
    response = client.get("/v1/public/config")
    assert response.status_code == 500
    problem = response.json()["error"]
    assert marker not in response.text
    assert marker not in caplog.text
    assert any(problem["correlation_id"] in str(record.__dict__) for record in caplog.records)


def test_equal_request_ids_in_different_users_never_combine_activity_counts(setup):
    app, admin_client, company, _admin, clock, _settings = setup
    login(app, admin_client)
    admin_credentials, _ = connect(app, admin_client)
    first_request, first_attempt = observations(clock[0])
    assert upload(admin_client, admin_credentials, [first_request, first_attempt]).status_code == 200

    with TestClient(app, base_url=company.data["origin"]) as member_client:
        member_client.headers["Origin"] = company.data["origin"]
        member_login(app, member_client, "member@example.org")
        member_credentials, _ = connect(app, member_client)
        second_request, second_attempt = observations(clock[0])
        second_request["request_id"] = first_request["request_id"]
        second_attempt["request_id"] = first_request["request_id"]
        result = upload(member_client, member_credentials, [second_request, second_attempt])
        assert result.status_code == 200
        assert [item["status"] for item in result.json()["results"]] == ["applied", "applied"]
        assert member_client.get("/v1/me/summary?period=all").json()["attempt_count"] == "1"

    assert admin_client.get("/v1/me/summary?period=all").json()["attempt_count"] == "1"
    response = admin_client.get("/v1/admin/activity?period=all")
    assert response.status_code == 200
    whole = response.json()
    assert whole["request_count"] == "2" and whole["attempt_count"] == "2"
