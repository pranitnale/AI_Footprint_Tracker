"""Preference admission and installation publication guards use canonical server jobs."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from conftest import connect, member_login
from footprint_contracts import canonical_json, payload_hash
from footprint_estimator import BASELINE_METHOD_HASH, BASELINE_METHOD_ID
from sqlalchemy import delete, func, select
from test_analytics import observations, upload
from test_method_history import install_bundle, replacement

from aift import method_registry
from aift.db import Database, Observation, get, put
from aift.engine_history import EngineEstimate
from aift.engine_selection import handle_selection, selection_is_current
from aift.method_history import RecalculationJob
from aift.security import Problem, instant


@pytest.fixture
def enrolled(setup):
    app, client, company, _, now, settings = setup
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        member = app.state.service.member(session, company, "employee@example.org")
        device = put(
            session,
            "device",
            str(uuid4()),
            {"browser_family": "chrome", "status": "active", "created_at": instant(now[0])},
            company.id,
            member.id,
        )
    credentials = {"device_id": device.id}
    return app, client, company, member, now, settings, credentials


def body(revision=1, preference="original", method_id=BASELINE_METHOD_ID, method_hash=BASELINE_METHOD_HASH):
    return {
        "preference": preference,
        "selection_revision": revision,
        "method_id": method_id,
        "method_hash": method_hash,
        "operation_id": str(uuid4()),
    }


def invoke(enrolled, request=None, *, device_id=None, member_id=None, method=None, query=None):
    app, _, company, member, _, _, credentials = enrolled
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        return handle_selection(
            app.state.service.analytics,
            session,
            get(session, "company", company.id),
            get(session, "member", member_id or member.id),
            get(session, "device", device_id or credentials["device_id"]),
            method or ("PUT" if request is not None else "GET"),
            request if request is not None else {},
            query or {},
        )


def test_ordinary_member_durable_bounded_job_and_original_retention(enrolled):
    app, client, company, member, now, settings, credentials = enrolled
    assert member.role == "user"
    member_login(app, client, "employee@example.org")
    credentials, _ = connect(app, client)
    enrolled = (*enrolled[:6], credentials)
    records = [record for _ in range(3) for record in observations(now[0])]
    assert upload(client, credentials, records).status_code == 200
    assert invoke(enrolled) == {"selection": None, "compatibility": None, "recalculation": None}
    with app.state.db.transaction(readonly=True) as session:
        originals = {row.id: canonical_json(row.estimate) for row in session.scalars(select(Observation))}
    request = body()
    result = invoke(enrolled, request)
    identifier = result["selection"]["job_id"]
    assert result["compatibility"] == {"status": "supported", "reason": None}
    assert result["recalculation"]["status"] == "pending"
    assert invoke(enrolled, request) == result
    with Database(settings).transaction(readonly=True) as session:
        device = get(session, "device", credentials["device_id"])
        job = session.get(RecalculationJob, identifier)
        assert device.data["estimation_selection"] == result["selection"]
        assert job.owner == job.actor == member.id
        assert job.tenant == company.id
        assert selection_is_current(session, job)
        assert session.scalar(select(func.count()).select_from(RecalculationJob)) == 1
    methods = app.state.service.analytics.methods
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        methods.advance(session, company, session.get(RecalculationJob, identifier), 1)
    assert invoke(enrolled)["recalculation"]["status"] == "pending"
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 1
        assert {
            row.id: canonical_json(row.estimate) for row in session.scalars(select(Observation))
        } == originals
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        methods.advance(session, company, session.get(RecalculationJob, identifier), 100)
    completed = invoke(enrolled)
    assert completed["recalculation"]["status"] == "completed"
    assert completed["recalculation"]["processed_estimates"] == 3


@pytest.mark.parametrize(
    "field,value",
    [
        ("preference", "automatic"),
        ("preference", []),
        ("selection_revision", True),
        ("selection_revision", 0),
        ("selection_revision", -1),
        ("selection_revision", 2147483648),
        ("selection_revision", 1.0),
        ("selection_revision", "1"),
        ("method_hash", "A" * 64),
        ("method_hash", "a" * 63),
        ("method_hash", None),
        ("method_id", "../method"),
        ("method_id", "."),
        ("method_id", "-method"),
        ("method_id", "m" * 129),
        ("method_id", None),
        ("operation_id", "not-a-uuid"),
        ("operation_id", "urn:uuid:" + str(uuid4())),
        ("operation_id", uuid4().hex),
        ("operation_id", None),
        ("user_id", str(uuid4())),
        ("company_id", str(uuid4())),
        ("profile", {"energy": "1"}),
        ("totals", {"energy": "1"}),
    ],
)
def test_strict_selection_payload_rejects_scope_totals_and_invalid_domains(enrolled, field, value):
    with pytest.raises(Problem) as error:
        invoke(enrolled, {**body(), field: value})
    assert error.value.code == "invalid_payload"
    assert invoke(enrolled)["selection"] is None


@pytest.mark.parametrize(
    "missing", ["preference", "method_id", "method_hash", "operation_id", "selection_revision"]
)
def test_required_selection_fields(enrolled, missing):
    request = body()
    del request[missing]
    with pytest.raises(Problem) as error:
        invoke(enrolled, request)
    assert error.value.code == "invalid_payload"


def test_revision_and_operation_binding_conflicts_do_not_change_selection(enrolled):
    request = body(5)
    first = invoke(enrolled, request)
    for changed in (
        {**request, "operation_id": str(uuid4())},
        {**request, "preference": "build_default"},
        {**request, "selection_revision": 4},
    ):
        with pytest.raises(Problem) as error:
            invoke(enrolled, changed)
        assert error.value.code == "selection_revision_conflict"
    with pytest.raises(Problem) as error:
        invoke(enrolled, {**request, "selection_revision": 6})
    assert error.value.code == "idempotency_conflict"
    assert invoke(enrolled) == first


@pytest.mark.parametrize("preference", ["original", "build_default"])
def test_explicit_and_build_default_original_identity(enrolled, preference):
    assert invoke(enrolled, body(preference=preference))["compatibility"]["status"] == "supported"
    for changed, reason in (
        (body(2, method_hash="f" * 64), "method_hash_mismatch"),
        (body(2, preference="ecologits"), "engine_mismatch"),
    ):
        with pytest.raises(Problem) as error:
            invoke(enrolled, changed)
        assert error.value.code == reason
    assert invoke(enrolled)["selection"]["selection_revision"] == 1


@pytest.mark.parametrize("preference", ["ecologits", "build_default"])
def test_ecologits_identity_is_resolved_from_registry_not_id_spelling(enrolled, monkeypatch, preference):
    from aift.engine_adapter import packaged_definition

    definition = packaged_definition()
    resolve = method_registry.resolve
    monkeypatch.setattr(
        method_registry,
        "resolve",
        lambda session, name: definition if name == "future-method" else resolve(session, name),
    )
    result = invoke(
        enrolled, body(preference=preference, method_id="future-method", method_hash=payload_hash(definition))
    )
    assert result["compatibility"]["status"] == "supported"
    with pytest.raises(Problem) as error:
        invoke(enrolled, body(2, "original", "future-method", payload_hash(definition)))
    assert error.value.code == "engine_mismatch"


@pytest.mark.parametrize("mismatch", [None, "hash", "engine"])
def test_unknown_method_stays_pending_and_later_install_rechecks_identity(enrolled, mismatch):
    app, _, company, _, now, _, _ = enrolled
    bundle = replacement("future-reviewed-method")
    request = body(
        method_id=bundle["method_id"],
        method_hash="a" * 64 if mismatch == "hash" else payload_hash(bundle),
        preference="ecologits" if mismatch == "engine" else "original",
    )
    selected = invoke(enrolled, request)
    assert selected["compatibility"] == {"status": "pending", "reason": "method_unsupported"}
    assert selected["recalculation"]["status"] == "pending"
    identifier = selected["selection"]["job_id"]
    with app.state.db.transaction(readonly=True) as session:
        assert selection_is_current(session, session.get(RecalculationJob, identifier))
        assert session.scalar(select(func.count()).select_from(Observation)) == 0
    install_bundle(app, now[0], bundle)
    current = invoke(enrolled)
    with app.state.db.transaction(readonly=True) as session:
        assert selection_is_current(session, session.get(RecalculationJob, identifier)) == (mismatch is None)
    if mismatch:
        assert (
            current["compatibility"]["reason"]
            == {"hash": "method_hash_mismatch", "engine": "engine_mismatch"}[mismatch]
        )
        assert current["recalculation"]["status"] == "pending"
        assert current["recalculation"]["completed_at"] is None
    else:
        assert current["compatibility"]["status"] == "supported"
    assert current["selection"] == selected["selection"]


def test_supersession_only_changes_same_device_jobs(enrolled):
    app, _, company, member, now, _, credentials = enrolled
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        other_member = app.state.service.member(session, company, "coworker@example.org")
        devices = [
            put(
                session,
                "device",
                str(uuid4()),
                {"browser_family": "firefox", "status": "active", "created_at": instant(now[0])},
                company.id,
                owner,
            )
            for owner in (member.id, other_member.id)
        ]
        manual = app.state.service.analytics.methods.create(
            session,
            company,
            member,
            {"method_id": BASELINE_METHOD_ID, "operation_id": str(uuid4())},
            personal=True,
        )["job_id"]
    request = body()
    first = invoke(enrolled, request)["selection"]
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        app.state.service.analytics.methods.advance(
            session, company, session.get(RecalculationJob, first["job_id"])
        )
    assert invoke(enrolled)["recalculation"]["completed_at"] is not None
    sibling = invoke(enrolled, request, device_id=devices[0].id)["selection"]
    coworker = invoke(enrolled, request, device_id=devices[1].id, member_id=other_member.id)["selection"]
    next_selection = invoke(enrolled, body(2, "build_default"))["selection"]
    assert next_selection["selection_generation"] == 2
    assert len({first["job_id"], sibling["job_id"], coworker["job_id"], next_selection["job_id"]}) == 4
    with app.state.db.transaction(readonly=True) as session:
        old_job = session.get(RecalculationJob, first["job_id"])
        assert not selection_is_current(session, old_job)
        assert old_job.data["status"] == "superseded"
        assert old_job.data["completed_at"] is None
        old_status = app.state.service.analytics.methods.status(session, company, member, old_job.id)
        assert old_status["status"] == "superseded"
        assert old_status["completed_at"] is None
        for identifier in (sibling["job_id"], coworker["job_id"], manual, next_selection["job_id"]):
            assert selection_is_current(session, session.get(RecalculationJob, identifier))
        assert get(session, "device", devices[0].id).data["estimation_selection"] == sibling
        assert get(session, "device", devices[1].id).data["estimation_selection"] == coworker
    with pytest.raises(Problem) as error:
        invoke(enrolled, body(3), device_id=devices[1].id)
    assert error.value.code == "enrollment_revoked"


def test_missing_revoked_or_foreign_installation_never_selects(enrolled):
    app, _, company, member, _, _, credentials = enrolled
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        with pytest.raises(Problem) as error:
            handle_selection(app.state.service.analytics, session, company, member, None, "GET", {}, {})
        assert error.value.code == "installation_required"
    selected = invoke(enrolled, body())["selection"]
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        device = get(session, "device", credentials["device_id"])
        device.data = {**device.data, "status": "revoked"}
    with pytest.raises(Problem) as error:
        invoke(enrolled)
    assert error.value.code == "enrollment_revoked"
    with app.state.db.transaction(readonly=True) as session:
        assert not selection_is_current(session, session.get(RecalculationJob, selected["job_id"]))


def test_erased_job_is_not_recreated_by_selection_replay(enrolled):
    app, _, company, _, _, _, _ = enrolled
    request = body()
    selected = invoke(enrolled, request)["selection"]
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        session.execute(delete(RecalculationJob).where(RecalculationJob.id == selected["job_id"]))
    replay = invoke(enrolled, request)
    assert replay["selection"] == selected
    assert replay["recalculation"]["status"] == "invalidated"
    assert replay["recalculation"]["error_code"] == "deletion_changed"
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(RecalculationJob)) == 0


def test_failed_transaction_does_not_publish_selection_or_job(enrolled):
    app, _, company, member, _, _, credentials = enrolled
    with pytest.raises(RuntimeError), app.state.db.transaction(scope=company.data["origin"]) as session:
        handle_selection(
            app.state.service.analytics,
            session,
            company,
            member,
            get(session, "device", credentials["device_id"]),
            "PUT",
            body(),
            {},
        )
        raise RuntimeError("interrupted before commit")
    assert invoke(enrolled)["selection"] is None
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(RecalculationJob)) == 0


@pytest.mark.parametrize(
    "method,payload,query",
    [("POST", {}, {}), ("GET", {"preference": "original"}, {}), ("GET", {}, {"user_id": "other"})],
)
def test_wrong_verb_get_body_and_scope_queries_are_rejected(enrolled, method, payload, query):
    with pytest.raises(Problem) as error:
        invoke(enrolled, payload, method=method, query=query)
    assert error.value.code == "invalid_payload"


def test_authenticated_http_route_requires_installation_and_keeps_member_scope(enrolled):
    app, client, company, member, _, _, _ = enrolled
    member_login(app, client, "employee@example.org")
    assert client.get("/v1/me/estimation-selection").status_code == 403
    credentials, _ = connect(app, client)
    headers = {
        "Authorization": "Bearer " + credentials["access_token"],
        "Origin": "chrome-extension://test-extension",
    }
    assert client.get("/v1/me/estimation-selection", headers=headers).json()["selection"] is None
    request = body()
    selected = client.put("/v1/me/estimation-selection", headers=headers, json=request)
    assert selected.status_code == 200, selected.text
    assert client.put("/v1/me/estimation-selection", headers=headers, json=request).json() == selected.json()
    bad = client.put(
        "/v1/me/estimation-selection", headers=headers, json={**body(2), "user_id": str(uuid4())}
    )
    assert bad.status_code == 422
    with app.state.db.transaction(readonly=True) as session:
        job = session.get(RecalculationJob, selected.json()["selection"]["job_id"])
        assert job.owner == job.actor == member.id
        assert job.tenant == company.id
    assert client.get("/v1/admin/recalculations/" + job.id, headers=headers).status_code in {401, 403}


def test_missing_native_dependency_is_recoverable_without_switching_engine(enrolled, monkeypatch):
    from aift import engine_adapter

    definition = engine_adapter.packaged_definition()
    identity = engine_adapter.identity(definition)
    require = engine_adapter.require_native

    def unavailable(_):
        raise Problem("engine_unavailable", 409, True)

    monkeypatch.setattr(engine_adapter, "require_native", unavailable)
    selected = invoke(enrolled, body(1, "ecologits", identity["method_id"], identity["method_hash"]))
    assert selected["compatibility"] == {"status": "pending", "reason": "engine_unavailable"}
    assert selected["recalculation"]["status"] == "pending"
    assert selected["recalculation"]["completed_at"] is None
    app = enrolled[0]
    with app.state.db.transaction(readonly=True) as session:
        job = session.get(RecalculationJob, selected["selection"]["job_id"])
        assert selection_is_current(session, job)
    monkeypatch.setattr(engine_adapter, "require_native", require)
    assert invoke(enrolled)["compatibility"]["status"] == "supported"
    assert invoke(enrolled)["selection"] == selected["selection"]


@pytest.mark.parametrize("late_mismatch", [False, True])
def test_deletion_invalidation_wins_over_missing_method_compatibility(enrolled, late_mismatch):
    app, _, company, _, now, _, _ = enrolled
    request = body(method_id="future-method", method_hash="e" * 64)
    invoke(enrolled, request)
    if late_mismatch:
        install_bundle(app, now[0], replacement("future-method"))
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        row = get(session, "company", company.id)
        row.data = {**row.data, "epoch": row.data["epoch"] + 1}
    status = invoke(enrolled)
    assert status["compatibility"]["reason"] == (
        "method_hash_mismatch" if late_mismatch else "method_unsupported"
    )
    assert status["recalculation"]["status"] == "invalidated"
    assert status["recalculation"]["error_code"] == "deletion_changed"


@pytest.mark.parametrize("same_revision", [True, False])
def test_concurrent_selection_is_idempotent_and_newest_revision_wins(enrolled, same_revision):
    first = body()
    second = first if same_revision else body(2, "build_default")
    barrier = Barrier(2)

    def choose(request):
        barrier.wait(timeout=10)
        try:
            return invoke(enrolled, request)
        except Problem as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(choose, [first, second]))
    assert all(isinstance(result, dict) or result == "selection_revision_conflict" for result in outcomes)
    if same_revision:
        assert outcomes[0] == outcomes[1]
    selected = invoke(enrolled)["selection"]
    assert selected["selection_revision"] == (1 if same_revision else 2)
    with enrolled[0].state.db.transaction(readonly=True) as session:
        jobs = list(session.scalars(select(RecalculationJob)))
        assert len(jobs) <= (1 if same_revision else 2)
        assert [job.id for job in jobs if selection_is_current(session, job)] == [selected["job_id"]]
