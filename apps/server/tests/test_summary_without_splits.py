"""
splits=none (15 October 2026): the administrator and organization summaries without their day,
tool and model splits. A page without charts asks for it; the splits took most of the time and
made the organization summary larger than the extension accepts (1 MiB).
"""

import json
from itertools import count

import pytest
from conftest import PERSON_ANALYTICS
from organization_dataset import auth, build

from aift import analytics
from aift.analytics import Analytics

MONTH = {"period": "custom", "start": "2026-08-11", "end": "2026-09-11"}
SPLIT_KEYS = {"sites", "days", "models"}


@pytest.fixture
def organization(setup, monkeypatch):
    admin, people = build(setup)
    # Each summary names its snapshot with a fresh id. Numbering them from 1 for every request
    # makes two answers comparable byte for byte.
    ids = {"next": count(1)}
    monkeypatch.setattr(analytics, "uid", lambda: f"snapshot-{next(ids['next'])}")
    return admin, people, ids


def fetch(client, path, params, credentials, ids):
    ids["next"] = count(1)
    response = client.get(path, params=params, headers=auth(credentials) if credentials else {})
    assert response.status_code == 200, response.text
    return response


@PERSON_ANALYTICS
def test_summaries_without_splits_are_the_same_answer_minus_the_splits(organization, monkeypatch):
    admin, people, ids = organization
    admin_id = admin.get("/v1/auth/session").json()["user_id"]
    member, member_credentials = people[2]
    owner, owner_credentials = people[0]
    cases = [
        (admin, "/v1/admin/summary", MONTH, None),
        (admin, "/v1/admin/summary", {"period": "month"}, None),
        (admin, "/v1/admin/summary", {"period": "all"}, None),
        (admin, "/v1/admin/summary", {**MONTH, "user_id": admin_id}, None),
        (member, "/v1/company/summary", MONTH, member_credentials),
        (owner, "/v1/me/summary", MONTH, owner_credentials),
    ]
    for client, path, params, credentials in cases:
        full = fetch(client, path, params, credentials, ids)
        lean = fetch(client, path, {**params, "splits": "none"}, credentials, ids)
        whole = json.loads(full.content)
        if path != "/v1/me/summary":
            assert "sites" in whole, (path, params)
        assert not SPLIT_KEYS & set(json.loads(lean.content)), (path, params)
        # Every other field is unchanged, in the same order and byte for byte.
        expected = {k: v for k, v in whole.items() if k not in SPLIT_KEYS}
        assert lean.content == json.dumps(expected, ensure_ascii=False, separators=(",", ":")).encode(), (
            path,
            params,
        )
        assert len(lean.content) < len(full.content) or path == "/v1/me/summary"

    # The splits are not computed at all, not just left out of the answer.
    def refuse(*args, **kwargs):
        raise AssertionError("splits computed")

    monkeypatch.setattr(Analytics, "splits", refuse)
    assert fetch(admin, "/v1/admin/summary", {**MONTH, "splits": "none"}, None, ids).status_code == 200
    lean = fetch(member, "/v1/company/summary", {**MONTH, "splits": "none"}, member_credentials, ids)
    assert lean.json()["aggregate_status"] == "current"


def test_only_splits_none_is_accepted(organization):
    admin, people, _ = organization
    member, member_credentials = people[2]
    owner, owner_credentials = people[0]
    for value in ("all", "", "None", "sites"):
        for client, path, credentials in (
            (admin, "/v1/admin/summary", None),
            (member, "/v1/company/summary", member_credentials),
            (owner, "/v1/me/summary", owner_credentials),
        ):
            response = client.get(
                path,
                params={**MONTH, "splits": value},
                headers=auth(credentials) if credentials else {},
            )
            assert response.status_code == 422, (path, value)
            assert response.json()["error"]["code"] == "unsupported_filter"
    # A conversation summary has no splits to leave out.
    response = owner.get(
        "/v1/me/conversations/" + "0" * 64 + "/summary",
        params={"period": "all", "splits": "none"},
        headers=auth(owner_credentials),
    )
    assert response.status_code == 422
    # A repeated parameter is refused like any other duplicate.
    assert admin.get("/v1/admin/summary?splits=none&splits=none").status_code == 422
