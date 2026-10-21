"""
An organization of production size for summary and worker performance tests: five installations
of four members, about 340 live records and about 960 saved-history messages over four weeks. The
records propose the EcoLogits method the server ships or an earlier EcoLogits release kept in
method_bundles, and one member has a completed recalculation to the current release.
"""

from copy import deepcopy
from datetime import timedelta
from hashlib import sha256
from uuid import uuid4

from conftest import connect, login, member_login
from fastapi.testclient import TestClient
from test_analytics import observations, upload
from test_historical_usage import auth, message, page, send

from aift import engine_adapter
from aift.maintenance import run
from aift.method_registry import MethodBundle
from aift.security import instant

SITES = ("chatgpt", "claude", "gemini", "perplexity")
MODELS = {
    "chatgpt": ("chatgpt-gpt-5-6-sol", "chatgpt-gpt-5-6-luna"),
    "claude": ("claude-opus-4-8", None),
    "gemini": ("gemini-3-pro", None),
    "perplexity": (None,),
}


def eco():
    return engine_adapter.identity(engine_adapter.packaged_definition())


def earlier_release():
    """An earlier packaged EcoLogits release whose mappings were reviewed on another day."""
    definition = deepcopy(engine_adapter.packaged_definition())
    definition["mappings"]["review_date"] = "2026-09-01"
    return definition


def key(*parts):
    return sha256(":".join(map(str, parts)).encode()).hexdigest()


def refreshed(client, credentials):
    result = client.post(
        "/v1/auth/refresh",
        json={"refresh_token": credentials["refresh_token"], "operation_id": str(uuid4())},
    )
    assert result.status_code == 200, result.text
    return result.json()


def build(setup, members=4, days=25, live_per_member=38, conversations_per_member=10, messages=24):
    """Returns (administrator client, [(client, credentials)]). The clock ends where it started."""
    app, admin, company, _, now, _ = setup
    end = now[0]
    now[0] = end - timedelta(days=days + 2)
    previous = earlier_release()
    with app.state.db.transaction(scope="method-install") as session:
        session.add(
            MethodBundle(
                method_id=engine_adapter.identity(previous)["method_id"],
                method_hash=engine_adapter.identity(previous)["method_hash"],
                bundle=previous,
                approval={"trust": "packaged_release"},
                installed_at=instant(now[0]),
            )
        )
    login(app, admin)
    people = [(admin, connect(app, admin)[0])]
    # The administrator has a second installation, like a laptop and a desktop.
    people.append((admin, connect(app, admin)[0]))
    for index in range(members - 1):
        person = TestClient(app, base_url=company.origin)
        person.headers["Origin"] = company.origin
        member_login(app, person, f"person{index}@example.org")
        people.append((person, connect(app, person)[0]))
    # The installations connected four weeks ago; today they refresh their access as usual.
    now[0] = end
    login(app, admin)
    people = [(client, refreshed(client, credentials)) for client, credentials in people]
    methods = (eco(), engine_adapter.identity(previous))
    for index, (client, credentials) in enumerate(people):
        records = []
        for n in range(live_per_member if index != 1 else live_per_member // 2):
            when = end - timedelta(days=days - n % days, hours=n % 7)
            site = SITES[(index + n) % len(SITES)]
            request, attempt = observations(when, str(100 + 37 * n))
            request["site"] = site
            request["conversation_key"] = key("conversation", index, n % conversations_per_member)
            model = MODELS[site][n % len(MODELS[site])]
            request["model_id"] = model
            request["model_evidence"] = "response_field" if model else "unknown"
            attempt["provider_attempt_key"] = key("attempt", index, n)
            if n % 5:
                attempt["proposed_method_id"] = methods[n % 3 == 0]["method_id"]
            records += [request, attempt]
        for start in range(0, len(records), 100):
            result = upload(client, credentials, records[start : start + 100])
            assert result.status_code == 200, result.text
            assert all(r["status"] == "applied" for r in result.json()["results"]), result.text
    for index, (client, credentials) in enumerate(people):
        if index == 1:
            continue
        for c in range(conversations_per_member):
            # The saved chat is the live one with the same number, on the same tool.
            site = SITES[(index + c) % len(SITES)]
            conversation = key("conversation", index, c)
            batch = []
            for n in range(messages):
                role = "prompt" if n % 2 == 0 else "response"
                record = message(end, key("message", index, c, n), role)
                record["site"] = site
                record["conversation_key"] = conversation
                record["occurred_at"] = (
                    instant(end - timedelta(days=(c * 3 + n) % days, minutes=n)) if n % 11 else None
                )
                if record["occurred_at"] is None:
                    record["date_basis"] = "unknown"
                record["parent_key"] = key("message", index, c, n - 1) if n else None
                if role == "response":
                    method = methods[c % 2]
                    record["prompt_key"] = key("message", index, c, n - 1)
                    record["proposed_method_id"] = method["method_id"]
                    record["proposed_method_hash"] = method["method_hash"]
                    record["model_id"] = MODELS[site][0]
                    # The first reply is live attempt number c, so it links to that attempt; a
                    # few later replies name attempts the extension never captured.
                    if n == 1:
                        record["provider_attempt_key"] = key("attempt", index, c)
                    elif n % 4 == 1:
                        record["provider_attempt_key"] = key("saved attempt", index, c, n)
                batch.append(record)
            body = page(end, batch)
            body["site"] = site
            body["conversation_key"] = conversation
            result = send(client, credentials, body)
            assert result.status_code == 200, result.text
    client, credentials = people[0]
    created = client.post(
        "/v1/me/recalculations",
        headers=auth(credentials),
        json={"method_id": methods[0]["method_id"], "operation_id": str(uuid4())},
    )
    assert created.status_code == 200, created.text
    for _ in range(40):
        run(app.state.service)
        status = client.get(
            "/v1/me/recalculations/" + created.json()["job_id"], headers=auth(credentials)
        ).json()
        if status["status"] == "completed":
            break
    assert status["status"] == "completed", status
    return admin, people


def choose_ecologits(app, client, credentials):
    """The member chooses EcoLogits in the extension's settings and the worker recalculates their
    records, so their own summaries become the recalculated view."""
    selected = client.put(
        "/v1/me/estimation-selection",
        headers=auth(credentials),
        json={
            "preference": "ecologits",
            "selection_revision": 1,
            "method_id": eco()["method_id"],
            "method_hash": eco()["method_hash"],
            "operation_id": str(uuid4()),
        },
    )
    assert selected.status_code == 200, selected.text
    for _ in range(200):
        run(app.state.service)
        state = client.get("/v1/me/estimation-selection", headers=auth(credentials)).json()
        if state["recalculation"]["status"] == "completed":
            return
    raise AssertionError(state)


__all__ = ["auth", "build", "choose_ecologits", "earlier_release", "eco", "key"]
