"""The organization summary split by day, tool and model, shown to members whatever the group size."""

from conftest import connect, login, member_login
from fastapi.testclient import TestClient
from test_analytics import observations, upload


def organization(setup, models):
    app, admin, company, _, now, _ = setup
    login(app, admin)
    people = []
    for index, model in enumerate(models):
        person = TestClient(app, base_url=company.origin)
        person.headers["Origin"] = company.origin
        member_login(app, person, f"person{index}@example.org")
        credentials, _ = connect(app, person)
        request, attempt = observations(now[0])
        attempt["provider_attempt_key"] = str(index) * 64
        request["model_id"] = model
        request["model_evidence"] = "response_field"
        result = upload(person, credentials, [request, attempt])
        assert all(row["status"] == "applied" for row in result.json()["results"]), result.text
        people.append(person)
    return now, people


def test_splits_by_day_tool_and_model_add_up_to_the_whole(setup):
    now, people = organization(setup, ["chatgpt-gpt-5-6-sol"] * 5)
    result = people[-1].get("/v1/company/summary")
    assert result.status_code == 200, result.text
    whole = result.json()
    assert whole["suppressed"] is False
    assert set(whole["sites"]) == {"chatgpt"}
    assert whole["sites"]["chatgpt"]["request_count"] == whole["request_count"] == "5"
    assert whole["sites"]["chatgpt"]["active_users"] == "5"
    day = now[0].astimezone().date().isoformat()
    assert list(whole["days"]) == [day] or len(whole["days"]) == 1
    assert next(iter(whole["days"].values()))["request_count"] == "5"
    assert set(whole["models"]) == {"chatgpt-gpt-5-6-sol"}
    assert whole["models"]["chatgpt-gpt-5-6-sol"]["site"] == "chatgpt"
    assert whole["models"]["chatgpt-gpt-5-6-sol"]["request_count"] == "5"
    # Every part carries its saved-history part, like the whole summary.
    assert "history" in whole["sites"]["chatgpt"] and "history" in whole["models"]["chatgpt-gpt-5-6-sol"]
    # A caller still cannot ask for one model directly.
    assert people[-1].get("/v1/company/summary", params={"model": "chatgpt-gpt-5-6-sol"}).status_code == 422


def test_a_model_used_by_one_person_shows_in_the_model_split(setup):
    _, people = organization(setup, ["chatgpt-gpt-5-6-sol"] * 4 + ["chatgpt-gpt-5-6-luna"])
    whole = people[-1].get("/v1/company/summary").json()
    # Members see every model, including one only a single person used (owner decision of
    # 13 October 2026).
    assert whole["suppressed"] is False
    assert set(whole["sites"]) == {"chatgpt"} and len(whole["days"]) == 1
    assert {k: v["request_count"] for k, v in whole["models"].items()} == {
        "chatgpt-gpt-5-6-sol": "4",
        "chatgpt-gpt-5-6-luna": "1",
    }


def test_splits_leave_out_an_all_time_daily_series(setup):
    _, people = organization(setup, ["chatgpt-gpt-5-6-sol"] * 5)
    whole = people[-1].get("/v1/company/summary", params={"period": "all"}).json()
    assert whole["suppressed"] is False
    assert "days" not in whole and set(whole["sites"]) == {"chatgpt"}
