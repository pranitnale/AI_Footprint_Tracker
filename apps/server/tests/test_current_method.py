"""
The server keeps an organization's records calculated with its packaged method
(MethodHistory.keep_current), whatever method each member's browser used. On 23 November 2026 an
organization total went blank because members' browsers ran two EcoLogits data versions, whose
figures never add. Originals are never changed, and an organization that was never asked for
these figures is left exactly as before.
"""

import csv
import io
import re
from copy import deepcopy
from datetime import timedelta
from decimal import Decimal, localcontext
from uuid import uuid4

from conftest import confirmed, connect, login, member_login
from fastapi.testclient import TestClient
from organization_dataset import earlier_release, eco, key
from sqlalchemy import event, func, select
from test_analytics import observations, recompose, upload
from test_completion import finish_job, reauth
from test_historical_usage import auth, message, page, send
from test_method_history import create_job, install_bundle, replacement, tick

from aift import engine_adapter, method_registry
from aift.db import Observation, get
from aift.engine_history import EngineEstimate
from aift.maintenance import run
from aift.method_history import PAGE_SIZE, SYSTEM_ACTOR, RecalculationJob, current_job_id
from aift.method_registry import MethodBundle
from aift.security import instant

# Statements an upload of one reply may add once the organization has the server's job. The
# hook reads the member's missing records twice (live and saved) and stores one estimate.
HOOK_STATEMENTS = 30


def organization(setup):
    """Two members. The administrator's browser runs an earlier EcoLogits release, the other
    member's the release the server packages."""
    app, admin, company, member, now, _ = setup
    previous = earlier_release()
    old = engine_adapter.identity(previous)
    with app.state.db.transaction(scope="method-install") as session:
        session.add(
            MethodBundle(
                method_id=old["method_id"],
                method_hash=old["method_hash"],
                bundle=previous,
                approval={"trust": "packaged_release"},
                installed_at=instant(now[0]),
            )
        )
    login(app, admin)
    first = connect(app, admin)[0]
    other = TestClient(app, base_url=company.origin)
    other.headers["Origin"] = company.origin
    member_login(app, other, "person@example.org")
    second = connect(app, other)[0]
    return app, company, member, now, (admin, first, old), (other, second, eco())


def reply(now, method, **attempt_fields):
    request, attempt = observations(now)
    request["model_id"] = "chatgpt-gpt-5-6-sol"
    request["model_evidence"] = "response_field"
    attempt["proposed_method_id"] = method["method_id"]
    attempt.update(attempt_fields)
    return request, attempt


def saved(now, message_key, method, **fields):
    record = message(now, message_key)
    record["proposed_method_id"] = method["method_id"]
    record["proposed_method_hash"] = method["method_hash"]
    record.update(fields)
    return record


def applied(response):
    assert response.status_code == 200, response.text
    assert all(result["status"] == "applied" for result in response.json()["results"]), response.text


def ask(app, company):
    """What the first request for the organization's figures in the server's method does."""
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        methods = app.state.service.analytics.methods
        return methods.keep_current(session, get(session, "company", company.id), create=True).id


def server_job(session, company):
    return session.get(RecalculationJob, current_job_id(company.id, eco()["method_id"]))


def estimates(session, method, record_key=None):
    """The stored recalculations with the method, of one record or of all."""
    query = select(EngineEstimate).where(
        EngineEstimate.method_id == method["method_id"], EngineEstimate.view == "recalculated"
    )
    if record_key:
        query = query.where(EngineEstimate.record_key == record_key)
    return list(session.scalars(query))


def waiting(app, company):
    """Whether a current record of the organization still lacks its estimate in the server's method."""
    with app.state.db.transaction(readonly=True) as session:
        methods = app.state.service.analytics.methods
        return methods.incomplete(
            session, get(session, "company", company.id), eco()["method_id"], None, True
        )


def test_an_organization_without_records_gets_no_job(setup):
    app, company, member, now, _, _ = organization(setup)
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(RecalculationJob)) == 0


def test_the_worker_starts_the_job_so_the_first_request_is_answered(setup):
    """As after a server deploy: the records are there, the worker runs, and nobody has asked."""
    app, company, member, now, (old_browser, old_access, old), (new_browser, new_access, new) = (
        organization(setup)
    )
    applied(upload(old_browser, old_access, list(reply(now[0], old))))
    applied(upload(new_browser, new_access, list(reply(now[0], new))))
    assert send(old_browser, old_access, page(now[0], [saved(now[0], "1" * 64, old)])).status_code == 200
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        job = server_job(session, company)
        assert job.actor == SYSTEM_ACTOR and job.owner is None and job.data["status"] == "completed"
        assert len(estimates(session, new)) == 3
        identifier, processed = job.id, job.data["processed"]
    answer = read(new_browser, "/v1/company/summary", CURRENT, new_access)
    assert answer["aggregate_status"] == "current" and answer["attempt_count"] == "2"
    assert answer["recalculation_job_id"] == identifier
    assert requested_methods(answer) == {new["method_id"]}
    with app.state.db.transaction(readonly=True) as session:
        # The request found the figures made and calculated nothing itself.
        assert server_job(session, company).data["processed"] == processed


def test_a_reply_from_an_older_browser_is_calculated_with_the_server_method_in_its_upload(setup):
    app, company, member, now, (old_browser, old_access, old), (new_browser, new_access, new) = (
        organization(setup)
    )
    applied(upload(old_browser, old_access, list(reply(now[0], old))))
    applied(upload(new_browser, new_access, list(reply(now[0], new))))
    ask(app, company)
    with app.state.db.transaction(readonly=True) as session:
        assert server_job(session, company).data["status"] == "completed"
        assert len(estimates(session, new)) == 2
    # The older browser sends one more reply and a saved chat. No worker tick follows.
    request, attempt = reply(now[0], old)
    applied(upload(old_browser, old_access, [request, attempt]))
    assert send(old_browser, old_access, page(now[0], [saved(now[0], "2" * 64, old)])).status_code == 200
    assert not waiting(app, company)
    with app.state.db.transaction(readonly=True) as session:
        (live,) = estimates(session, new, attempt["attempt_id"])
        assert live.estimate["requested_method"]["method_id"] == new["method_id"]
        assert live.estimate["original_method_hash"] == old["method_hash"]
        (history,) = estimates(session, new, "2" * 64)
        assert history.family == "history" and history.original_method_hash == old["method_hash"]
        # The browser's own calculation is stored as it came.
        original = session.get(Observation, (company.id, member.id, "attempt", attempt["attempt_id"]))
        assert original.estimate["result"]["requested_method"]["method_id"] == old["method_id"]


def test_a_corrected_reply_is_calculated_at_once_and_the_earlier_estimate_stays_stored(setup):
    app, company, member, now, (old_browser, old_access, old), (_, _, new) = organization(setup)
    request, attempt = reply(now[0], old)
    applied(upload(old_browser, old_access, [request, attempt]))
    ask(app, company)
    corrected = deepcopy(attempt)
    corrected["revision"] = 2
    corrected["tokens"]["answer_output"]["value"] = "10"
    recompose(corrected)
    applied(upload(old_browser, old_access, [corrected]))
    assert not waiting(app, company)
    with app.state.db.transaction(readonly=True) as session:
        revisions = {
            row.estimate["source"]["attempt_revision"]
            for row in estimates(session, new, attempt["attempt_id"])
        }
        assert revisions == {1, 2}


def test_a_saved_reply_that_names_a_live_reply_has_that_reply_calculated_again_in_its_upload(setup):
    app, company, member, now, (old_browser, old_access, old), (_, _, new) = organization(setup)
    named = key("provider attempt", 1)
    request, attempt = reply(now[0], old, provider_attempt_key=named)
    applied(upload(old_browser, old_access, [request, attempt]))
    ask(app, company)
    with app.state.db.transaction(readonly=True) as session:
        before = server_job(session, company).data["processed"]
    record = saved(
        now[0],
        "3" * 64,
        old,
        site=request["site"],
        conversation_key=request["conversation_key"],
        provider_attempt_key=named,
        model_id=request["model_id"],
    )
    body = page(now[0], [record])
    body["site"], body["conversation_key"] = request["site"], request["conversation_key"]
    assert send(old_browser, old_access, body).status_code == 200
    assert not waiting(app, company)
    with app.state.db.transaction(readonly=True) as session:
        # The page made the live reply's estimate stale (invalidate_linked_estimates), so the
        # upload calculated the saved reply and the live reply.
        assert server_job(session, company).data["processed"] == before + 2
        assert len(estimates(session, new, attempt["attempt_id"])) == 1


def test_a_new_packaged_method_is_taken_up_by_the_worker_and_earlier_estimates_stay(setup, monkeypatch):
    app, company, member, now, (old_browser, old_access, old), (new_browser, new_access, new) = (
        organization(setup)
    )
    _, old_attempt = records = reply(now[0], old)
    applied(upload(old_browser, old_access, list(records)))
    applied(upload(new_browser, new_access, list(reply(now[0], new))))
    ask(app, company)
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        stored = session.get(Observation, (company.id, member.id, "attempt", old_attempt["attempt_id"]))
        original = deepcopy(stored.estimate)
    # The next server release packages newer data, which is another method.
    following = deepcopy(engine_adapter.packaged_definition())
    following["mappings"]["review_date"] = "2026-12-01"
    monkeypatch.setattr(engine_adapter, "packaged_definition", lambda: following)
    latest = eco()
    assert latest["method_id"] not in {old["method_id"], new["method_id"]}
    # An upload between the deploy and the worker's first tick changes nothing and still succeeds.
    applied(upload(new_browser, new_access, list(reply(now[0], new))))
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        jobs = list(session.scalars(select(RecalculationJob).where(RecalculationJob.actor == SYSTEM_ACTOR)))
        assert [job.method_id for job in jobs] == [latest["method_id"]]
        assert jobs[0].owner is None and jobs[0].data["status"] == "completed"
        assert len(estimates(session, latest)) == 3
        # Nothing is overwritten: the estimates of the earlier packaged method and the
        # browser's own calculation are still stored.
        assert len(estimates(session, new)) == 2
        stored = session.get(Observation, (company.id, member.id, "attempt", old_attempt["attempt_id"]))
        assert stored.estimate == original
    assert not waiting(app, company)


def test_a_reply_whose_method_the_server_does_not_know_does_not_hold_the_organization_back(setup):
    app, company, member, now, (old_browser, old_access, _), (new_browser, new_access, new) = (
        organization(setup)
    )
    future = replacement("reviewed-future-v3")
    request, attempt = reply(now[0], {"method_id": future["method_id"]})
    assert upload(old_browser, old_access, [request, attempt]).status_code == 200
    applied(upload(new_browser, new_access, list(reply(now[0], new))))
    ask(app, company)
    with app.state.db.transaction(readonly=True) as session:
        assert server_job(session, company).data["status"] == "completed"
        assert len(estimates(session, new)) == 1
        assert estimates(session, new, attempt["attempt_id"]) == []
    # A member's own job keeps its rule: it waits for every record of that member.
    history, identifier = create_job(app, company, member, new["method_id"])
    tick(app, company, history, identifier)
    with app.state.db.transaction(readonly=True) as session:
        assert history.status(session, company, member, identifier)["status"] == "pending"
    # Once the server knows the method, the worker calculates the reply by itself.
    install_bundle(app, now[0], future)
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        (late,) = estimates(session, new, attempt["attempt_id"])
        assert late.estimate["requested_method"]["method_id"] == new["method_id"]
        assert server_job(session, company).data["status"] == "completed"


def test_a_reply_that_names_no_model_still_gets_its_estimate(setup):
    """The server refuses a model id it does not list at upload, so the only reply without a
    listed model is one that names none. It must not hold the organization back either."""
    app, company, member, now, (old_browser, old_access, old), (_, _, new) = organization(setup)
    request, attempt = reply(now[0], old)
    request["model_id"], request["model_evidence"] = None, "unknown"
    applied(upload(old_browser, old_access, [request, attempt]))
    ask(app, company)
    with app.state.db.transaction(readonly=True) as session:
        (row,) = estimates(session, new, attempt["attempt_id"])
        assert row.estimate["requested_method"]["method_id"] == new["method_id"]
        assert server_job(session, company).data["status"] == "completed"


def test_an_erasure_removes_the_estimates_and_the_job_and_a_new_request_starts_clean(setup):
    app, company, member, now, (old_browser, old_access, old), (new_browser, new_access, new) = (
        organization(setup)
    )
    applied(upload(old_browser, old_access, list(reply(now[0], old))))
    ask(app, company)
    preview = old_browser.post(
        "/v1/admin/deletions/preview",
        json={
            "scope": "range",
            "start": instant(now[0] - timedelta(seconds=1)),
            "end": instant(now[0] + timedelta(seconds=1)),
        },
    ).json()
    body = {
        "preview_token": preview["preview_token"],
        "idempotency_key": str(uuid4()),
        "confirmed": True,
        "reauth_token": reauth(app, company, member),
    }
    assert old_browser.post("/v1/admin/deletions", json=body).status_code == 200
    finish_job(app, company, body["idempotency_key"])
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 0
        assert session.scalar(select(func.count()).select_from(RecalculationJob)) == 0
    now[0] += timedelta(minutes=1)
    request, attempt = reply(now[0], new)
    applied(upload(new_browser, new_access, [request, attempt], epoch=1))
    ask(app, company)
    with app.state.db.transaction(readonly=True) as session:
        job = server_job(session, company)
        assert job.data["status"] == "completed" and job.data["deletion_epoch"] == 1
        assert len(estimates(session, new, attempt["attempt_id"])) == 1


def test_the_server_job_is_an_ordinary_organization_job_for_the_previous_server_build(setup, monkeypatch):
    """A rollback leaves the job in the table. The previous build has no upload hook and its
    worker advances every job the same way, with the plain call made here."""
    app, company, member, now, (old_browser, old_access, old), (_, _, new) = organization(setup)
    identifier = ask(app, company)
    methods = app.state.service.analytics.methods
    with monkeypatch.context() as previous_build:
        previous_build.setattr(type(methods), "keep_current", lambda *args, **kwargs: None)
        request, attempt = reply(now[0], old)
        applied(upload(old_browser, old_access, [request, attempt]))
        assert waiting(app, company)
        with app.state.db.transaction(scope=company.data["origin"]) as session:
            job = session.get(RecalculationJob, identifier)
            assert {
                "status",
                "created_at",
                "processed",
                "completed_at",
                "error_code",
                "deletion_epoch",
                "admin_requested",
            } <= set(job.data)
            methods.advance(session, get(session, "company", company.id), job, PAGE_SIZE)
    assert not waiting(app, company)
    status = old_browser.get("/v1/admin/recalculations/" + identifier)
    assert status.status_code == 200, status.text
    assert status.json()["status"] == "completed" and status.json()["processed_estimates"] == 1


def test_the_upload_hook_is_bounded_and_never_fails_an_upload(setup, monkeypatch):
    app, company, member, now, (old_browser, old_access, old), (_, _, new) = organization(setup)
    statements = [0]

    def count(conn, cursor, sql, parameters, context, executemany):
        statements[0] += 1

    def counted_upload():
        event.listen(app.state.db.engine, "before_cursor_execute", count)
        try:
            statements[0] = 0
            applied(upload(old_browser, old_access, list(reply(now[0], old))))
            return statements[0]
        finally:
            event.remove(app.state.db.engine, "before_cursor_execute", count)

    # Each count follows one upload of the same kind, so caches are warm for both.
    counted_upload()
    plain = counted_upload()
    ask(app, company)
    counted_upload()
    hooked = counted_upload()
    assert not waiting(app, company)
    assert hooked - plain <= HOOK_STATEMENTS, (plain, hooked)

    real = method_registry.estimate
    for failure in (RuntimeError("synthetic calculator interruption"), KeyError("unexpected")):

        def failing(session, observation, options=None, _failure=failure, **rest):
            if options and options.get("view") == "recalculated":
                raise _failure
            return real(session, observation, options, **rest)

        monkeypatch.setattr(method_registry, "estimate", failing)
        applied(upload(old_browser, old_access, list(reply(now[0], old))))
        # Never a figure from part of the records: the organization waits instead.
        assert waiting(app, company)
        monkeypatch.setattr(method_registry, "estimate", real)
        run(app.state.service)
        assert not waiting(app, company)

    # A complete job costs the worker no calculation.
    def unexpected(*args, **kwargs):
        raise RuntimeError("the worker calculated again")

    monkeypatch.setattr(method_registry, "estimate", unexpected)
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        assert server_job(session, company).data["status"] == "completed"


# The request of an extension or of the admin website for the organization's figures in the
# server's method. An extension of version 0.1.0 never sends it.
CURRENT = {"period": "all", "calculation_view": "current"}


def scrub(value):
    """A summary without the fields that name the snapshot rather than the figures."""
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items() if k not in {"snapshot_id", "generated_at"}}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    return value


def requested_methods(value):
    """Every method a summary names for a figure: totals, saved history and each split."""
    found = set()
    if isinstance(value, dict):
        if isinstance(value.get("requested_method"), dict):
            found.add(value["requested_method"]["method_id"])
        for child in value.values():
            found |= requested_methods(child)
    elif isinstance(value, list):
        for child in value:
            found |= requested_methods(child)
    return found


def energy(summary):
    rows = [*summary["resources"], *summary["history"]["resources"]]
    values = [row["value"] for row in rows if row["quantity"] == "energy" and row["value"] is not None]
    with localcontext() as context:
        context.prec = 90
        return sum(map(Decimal, values), Decimal(0))


def read(client, path, params, access=None):
    response = client.get(path, params=params, headers=auth(access) if access else {})
    assert response.status_code == 200, response.text
    return response.json()


def failing_recalculation(monkeypatch):
    """Recalculations of live replies fail; the browsers' own calculations still arrive."""
    real = method_registry.estimate

    def failing(session, observation, options=None, **rest):
        if options and options.get("view") == "recalculated":
            raise RuntimeError("synthetic calculator interruption")
        return real(session, observation, options, **rest)

    monkeypatch.setattr(method_registry, "estimate", failing)
    return real


def test_two_browsers_of_different_methods_give_one_organization_total(setup):
    app, company, member, now, (old_browser, old_access, old), (new_browser, new_access, new) = (
        organization(setup)
    )
    applied(upload(old_browser, old_access, list(reply(now[0], old))))
    applied(upload(new_browser, new_access, list(reply(now[0], new))))
    assert send(old_browser, old_access, page(now[0], [saved(now[0], "4" * 64, old)])).status_code == 200
    # The older browser has its own job on the server, as every connected extension has.
    created = old_browser.post(
        "/v1/me/recalculations",
        headers=auth(old_access),
        json={"method_id": old["method_id"], "operation_id": str(uuid4())},
    )
    assert created.status_code == 200, created.text
    run(app.state.service)
    # What version 0.1.0 asks: the organization as recorded, and its own figures in its method.
    published = {
        "organization": (
            new_browser,
            "/v1/company/summary",
            {"period": "all", "calculation_view": "original"},
            new_access,
        ),
        "own": (
            old_browser,
            "/v1/me/summary",
            {"period": "all", "calculation_view": "recalculated", "method_id": old["method_id"]},
            old_access,
        ),
    }
    before = {name: scrub(read(*call)) for name, call in published.items()}
    # Rows of the two methods never add, which left the organization total blank.
    assert requested_methods(before["organization"]) == {old["method_id"], new["method_id"]}
    assert requested_methods(before["own"]) == {old["method_id"]}

    answers = {
        "organization": read(new_browser, "/v1/company/summary", CURRENT, new_access),
        "administrator": read(old_browser, "/v1/admin/summary", CURRENT),
        "activity": read(old_browser, "/v1/admin/activity", CURRENT),
        "older browser": read(old_browser, "/v1/me/summary", CURRENT, old_access),
        "newer browser": read(new_browser, "/v1/me/summary", CURRENT, new_access),
    }
    for name, answer in answers.items():
        assert answer["aggregate_status"] == "current", name
        assert answer["calculation_view"] == "recalculated", name
        assert (answer["method_id"], answer["method_hash"]) == (new["method_id"], new["method_hash"]), name
        assert re.fullmatch("[a-f0-9]{64}", answer["recalculation_job_id"]), name
        assert requested_methods(answer) == {new["method_id"]}, name
    assert answers["organization"]["attempt_count"] == "2"
    total = energy(answers["organization"])
    assert total > 0
    assert total == energy(answers["administrator"]) == energy(answers["activity"])
    # Each member's own figures are in the same method, so a share of the total can be shown.
    assert total == energy(answers["older browser"]) + energy(answers["newer browser"])

    # A reply and a saved chat from the older browser are in the next answer, with no worker tick.
    applied(upload(old_browser, old_access, list(reply(now[0], old))))
    assert send(old_browser, old_access, page(now[0], [saved(now[0], "5" * 64, old)])).status_code == 200
    later = read(new_browser, "/v1/company/summary", CURRENT, new_access)
    assert later["attempt_count"] == "3" and requested_methods(later) == {new["method_id"]}
    assert energy(later) > total

    # Version 0.1.0 gets the answers it got before, whatever the server's own job does. Its own
    # figures wait for the worker's tick after each upload, as they always have.
    run(app.state.service)
    unchanged = {name: scrub(read(*call)) for name, call in published.items()}
    assert requested_methods(unchanged["organization"]) == {old["method_id"], new["method_id"]}
    assert requested_methods(unchanged["own"]) == {old["method_id"]}
    run(app.state.service)
    assert {name: scrub(read(*call)) for name, call in published.items()} == unchanged

    # An export in the server's method needs no administrator to prepare it first.
    exported = old_browser.post(
        "/v1/admin/exports",
        json=confirmed(
            old_browser, {"calculation_view": "recalculated", "method_id": new["method_id"], "period": "all"}
        ),
    )
    assert exported.status_code == 200, exported.text
    downloaded = old_browser.get(exported.json()["download_path"])
    assert downloaded.status_code == 200, downloaded.text
    rows = list(csv.DictReader(io.StringIO(downloaded.text)))
    assert rows and all(row["calculation_view"] == "recalculated" for row in rows)


def test_the_published_extension_gets_the_same_answers_with_and_without_the_server_job(setup):
    """Version 0.1.0 asks the organization as recorded and its own figures in its own method.
    The same records give the same answers whether or not the server's job has run."""
    app, company, member, now, (old_browser, old_access, old), (new_browser, new_access, new) = (
        organization(setup)
    )
    applied(upload(old_browser, old_access, list(reply(now[0], old))))
    applied(upload(new_browser, new_access, list(reply(now[0], new))))
    assert send(old_browser, old_access, page(now[0], [saved(now[0], "7" * 64, old)])).status_code == 200
    # The older browser's own job is finished without a worker run, so no server job exists yet.
    history, identifier = create_job(app, company, member, old["method_id"])
    tick(app, company, history, identifier)
    with app.state.db.transaction(readonly=True) as session:
        assert server_job(session, company) is None
    calls = (
        (new_browser, "/v1/company/summary", {"period": "all", "calculation_view": "original"}, new_access),
        (
            old_browser,
            "/v1/me/summary",
            {"period": "all", "calculation_view": "recalculated", "method_id": old["method_id"]},
            old_access,
        ),
        (old_browser, "/v1/admin/summary", {"period": "all"}, None),
    )
    before = [scrub(read(*call)) for call in calls]
    read(new_browser, "/v1/company/summary", CURRENT, new_access)
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        assert server_job(session, company).data["status"] == "completed"
    assert [scrub(read(*call)) for call in calls] == before


def test_figures_that_could_not_be_finished_answer_409_and_the_job_is_kept(setup, monkeypatch):
    app, company, member, now, (old_browser, old_access, old), (new_browser, new_access, new) = (
        organization(setup)
    )
    applied(upload(old_browser, old_access, list(reply(now[0], old))))
    applied(upload(new_browser, new_access, list(reply(now[0], new))))
    real = failing_recalculation(monkeypatch)
    for path, client, access in (
        ("/v1/company/summary", new_browser, new_access),
        ("/v1/me/summary", new_browser, new_access),
        ("/v1/admin/summary", old_browser, None),
    ):
        refused = client.get(path, params=CURRENT, headers=auth(access) if access else {})
        # Never part of the records and never two methods: no figures until all are done.
        assert refused.status_code == 409, refused.text
        assert refused.json()["error"]["code"] == "recalculation_pending"
        assert refused.json()["error"]["retryable"] is True
    with app.state.db.transaction(readonly=True) as session:
        assert server_job(session, company) is not None
    monkeypatch.setattr(method_registry, "estimate", real)
    run(app.state.service)
    answer = read(new_browser, "/v1/company/summary", CURRENT, new_access)
    assert requested_methods(answer) == {new["method_id"]}


def test_a_new_packaged_method_answers_in_that_method_and_never_in_two(setup, monkeypatch):
    app, company, member, now, (old_browser, old_access, old), (new_browser, new_access, new) = (
        organization(setup)
    )
    applied(upload(old_browser, old_access, list(reply(now[0], old))))
    applied(upload(new_browser, new_access, list(reply(now[0], new))))
    assert read(new_browser, "/v1/company/summary", CURRENT, new_access)["method_id"] == new["method_id"]
    run(app.state.service)
    following = deepcopy(engine_adapter.packaged_definition())
    following["mappings"]["review_date"] = "2026-12-01"
    monkeypatch.setattr(engine_adapter, "packaged_definition", lambda: following)
    latest = eco()
    real = failing_recalculation(monkeypatch)
    # Until every record is calculated with the new method there is no answer: not the earlier
    # method's figures under the new name, and not a mix.
    refused = new_browser.get("/v1/company/summary", params=CURRENT, headers=auth(new_access))
    assert refused.status_code == 409, refused.text
    monkeypatch.setattr(method_registry, "estimate", real)
    run(app.state.service)
    answer = read(new_browser, "/v1/company/summary", CURRENT, new_access)
    assert answer["method_id"] == latest["method_id"]
    assert requested_methods(answer) == {latest["method_id"]}
    with app.state.db.transaction(readonly=True) as session:
        assert len(estimates(session, new)) == 2 and len(estimates(session, latest)) == 2


def test_an_erasure_answers_being_updated_and_then_the_remaining_figures(setup, monkeypatch):
    app, company, member, now, (old_browser, old_access, old), (new_browser, new_access, new) = (
        organization(setup)
    )
    applied(upload(old_browser, old_access, list(reply(now[0], old))))
    assert read(old_browser, "/v1/admin/summary", CURRENT)["attempt_count"] == "1"
    # A large erasure is applied over several worker ticks. Meanwhile the answer is the one the
    # original view gives, with no figures and no method.
    deletions = app.state.service.analytics.deletions
    with monkeypatch.context() as applying:
        applying.setattr(type(deletions), "in_progress", lambda *args: True)
        during = read(old_browser, "/v1/admin/summary", CURRENT)
        assert during["aggregate_status"] == "rebuilding" and "method_id" not in during
        assert "resources" not in during
    # This small erasure is applied by its own request.
    preview = old_browser.post(
        "/v1/admin/deletions/preview",
        json={
            "scope": "range",
            "start": instant(now[0] - timedelta(seconds=1)),
            "end": instant(now[0] + timedelta(seconds=1)),
        },
    ).json()
    body = {
        "preview_token": preview["preview_token"],
        "idempotency_key": str(uuid4()),
        "confirmed": True,
        "reauth_token": reauth(app, company, member),
    }
    assert old_browser.post("/v1/admin/deletions", json=body).status_code == 200
    finish_job(app, company, body["idempotency_key"])
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(RecalculationJob)) == 0
    # The erasure deleted the job and left no records, so the worker starts none. The next
    # request starts it and is answered at once.
    after = read(old_browser, "/v1/admin/summary", CURRENT)
    assert after["aggregate_status"] == "current" and after["attempt_count"] == "0"
    assert after["method_id"] == new["method_id"]


def test_requests_the_current_view_does_not_serve_are_refused(setup):
    app, company, member, now, (old_browser, old_access, old), (new_browser, new_access, new) = (
        organization(setup)
    )
    request, attempt = reply(now[0], old)
    applied(upload(old_browser, old_access, [request, attempt]))
    assert send(old_browser, old_access, page(now[0], [saved(now[0], "6" * 64, old)])).status_code == 200
    view = {"calculation_view": "current"}
    for path, params in (
        ("/v1/company/summary", {**CURRENT, "method_id": new["method_id"]}),
        # A chat's own figures stay the browser's calculation.
        ("/v1/me/conversations/" + request["conversation_key"] + "/summary", {"period": "all", **view}),
        ("/v1/me/history/" + "b" * 64 + "/summary", {"period": "all", **view}),
        ("/v1/usage/records/attempt/" + attempt["attempt_id"], view),
    ):
        refused = old_browser.get(path, params=params, headers=auth(old_access))
        assert refused.status_code == 422, (path, refused.text)
        assert refused.json()["error"]["code"] == "unsupported_filter", path
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(RecalculationJob)) == 0
