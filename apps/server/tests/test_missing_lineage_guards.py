"""Missing-lineage claims need both strict adapter options and saved source evidence."""

from copy import deepcopy
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from conftest import connect, login
from estimation_contracts import validate_estimation_envelope
from footprint_contracts import canonical_json, payload_hash
from footprint_estimator import (
    BASELINE_METHOD_HASH,
    BASELINE_METHOD_ID,
    baseline_bundle,
    estimate_observation,
)
from sqlalchemy import func, select
from test_analytics import observations, upload
from test_historical_usage import message

from aift import engine_adapter, engine_history, method_registry
from aift.db import Observation
from aift.engine_history import EngineEstimate
from aift.security import Problem

MARKER = "unavailable-admission-v1"
NOW = datetime(2026, 9, 15, 12, tzinfo=UTC)


def definition(engine):
    return baseline_bundle() if engine == "original" else engine_adapter.packaged_definition()


def options(engine, **changes):
    return {
        "methodId": engine_adapter.identity(definition(engine))["method_id"],
        "view": "recalculated",
        "originalMethodHash": None,
        "originalMethodMissing": True,
        **changes,
    }


def source(proposed=MARKER):
    request, attempt = observations(NOW)
    attempt["proposed_method_id"] = proposed
    return request, attempt


def invoke(setup, route, engine, request, attempt, selected):
    if route == "native":
        return engine_adapter.estimate(definition(engine), attempt, request, selected)
    app, _, company, member, _, _ = setup
    with app.state.db.transaction(readonly=True) as session:
        return method_registry.estimate(
            session, attempt, selected, request=request, tenant=company.id, owner=member.id
        )


def rejected(action, *codes):
    with pytest.raises((Problem, ValueError)) as caught:
        action()
    code = caught.value.code if isinstance(caught.value, Problem) else str(caught.value)
    assert code in (codes or ("method_update_invalid",))


@pytest.mark.parametrize("route", ["native", "registry"])
@pytest.mark.parametrize("engine", ["original", "ecologits"])
@pytest.mark.parametrize("flag", [None, 0, 1, "true", "false", [], {}])
def test_missing_option_accepts_only_booleans_in_otherwise_eligible_calls(setup, route, engine, flag):
    # A coerced false or true would be valid, so this isolates strict boolean admission.
    declared = bool(flag)
    request, attempt = source(MARKER if declared else BASELINE_METHOD_ID)
    selected = options(
        engine, originalMethodMissing=declared, originalMethodHash=None if declared else BASELINE_METHOD_HASH
    )
    invoke(setup, route, engine, request, attempt, selected)
    selected["originalMethodMissing"] = flag
    rejected(lambda: invoke(setup, route, engine, request, attempt, selected))


@pytest.mark.parametrize("route", ["native", "registry"])
@pytest.mark.parametrize("engine", ["original", "ecologits"])
@pytest.mark.parametrize("view,original_hash", [("original", None), ("recalculated", BASELINE_METHOD_HASH)])
def test_marker_does_not_admit_original_view_or_known_lineage(setup, route, engine, view, original_hash):
    request, attempt = source()
    selected = options(engine, view=view, originalMethodHash=original_hash)
    rejected(lambda: invoke(setup, route, engine, request, attempt, selected))


@pytest.mark.parametrize("route", ["native", "registry"])
@pytest.mark.parametrize("engine", ["original", "ecologits"])
@pytest.mark.parametrize("flag", ["absent", False])
@pytest.mark.parametrize(
    "view,original_hash", [("original", None), ("recalculated", None), ("recalculated", BASELINE_METHOD_HASH)]
)
def test_reserved_marker_requires_explicit_missing_flag_for_every_view(
    setup, route, engine, flag, view, original_hash
):
    request, attempt = source()
    selected = options(engine, view=view, originalMethodHash=original_hash)
    if flag == "absent":
        selected.pop("originalMethodMissing")
    else:
        selected["originalMethodMissing"] = flag
    rejected(lambda: invoke(setup, route, engine, request, attempt, selected))


@pytest.mark.parametrize("route", ["native", "registry"])
@pytest.mark.parametrize("engine", ["original", "ecologits"])
@pytest.mark.parametrize("proposed", [None, BASELINE_METHOD_ID, "arbitrary-unknown-method"])
def test_true_flag_does_not_convert_other_sources_to_missing_original(setup, route, engine, proposed):
    request, attempt = source(proposed)
    rejected(lambda: invoke(setup, route, engine, request, attempt, options(engine)))


@pytest.mark.parametrize("engine", ["original", "ecologits"])
@pytest.mark.parametrize("target", [None, "", "unregistered-method"])
def test_native_missing_flag_needs_an_explicit_supported_target(engine, target):
    request, attempt = source()
    selected = options(engine)
    if target is None:
        selected.pop("methodId")
    else:
        selected["methodId"] = target
    rejected(
        lambda: engine_adapter.estimate(definition(engine), attempt, request, selected),
        "method_update_invalid",
        "method_unsupported",
    )


@pytest.mark.parametrize("engine", ["original", "ecologits"])
def test_native_definition_cannot_silently_replace_an_explicit_different_target(engine):
    request, attempt = source()
    other = "ecologits" if engine == "original" else "original"
    selected = options(engine, methodId=engine_adapter.identity(definition(other))["method_id"])
    rejected(lambda: engine_adapter.estimate(definition(engine), attempt, request, selected))


@pytest.mark.parametrize("route", ["native", "registry"])
@pytest.mark.parametrize("engine", ["original", "ecologits"])
@pytest.mark.parametrize("proposed", [MARKER, BASELINE_METHOD_ID])
def test_history_never_qualifies_for_missing_original_lineage(setup, route, engine, proposed):
    record = message(NOW)
    record["proposed_method_id"] = proposed
    if route == "native":
        rejected(lambda: engine_adapter.estimate(definition(engine), record, options=options(engine)))
    else:
        with setup[0].state.db.transaction(readonly=True) as session:
            rejected(lambda: method_registry.estimate_history(session, record, options(engine)))


@pytest.mark.parametrize("route", ["native", "registry"])
@pytest.mark.parametrize("engine", ["original", "ecologits"])
@pytest.mark.parametrize(
    "view,original_hash,flag",
    [("original", None, "absent"), ("recalculated", BASELINE_METHOD_HASH, False)],
)
def test_historical_marker_is_forbidden_even_without_flag_or_with_known_lineage(
    setup, route, engine, view, original_hash, flag
):
    record = message(NOW)
    record["proposed_method_id"] = MARKER
    selected = options(engine, view=view, originalMethodHash=original_hash)
    if flag == "absent":
        selected.pop("originalMethodMissing")
    else:
        selected["originalMethodMissing"] = flag
    if route == "native":
        rejected(lambda: engine_adapter.estimate(definition(engine), record, options=selected))
    else:
        with setup[0].state.db.transaction(readonly=True) as session:
            rejected(lambda: method_registry.estimate_history(session, record, selected))


@pytest.mark.parametrize("route", ["native", "registry"])
@pytest.mark.parametrize("engine", ["original", "ecologits"])
@pytest.mark.parametrize("flag", ["absent", False])
def test_null_recalculation_hash_without_marker_flag_is_rejected(setup, route, engine, flag):
    request, attempt = source(BASELINE_METHOD_ID)
    selected = options(engine)
    if flag == "absent":
        selected.pop("originalMethodMissing")
    else:
        selected["originalMethodMissing"] = False
    rejected(lambda: invoke(setup, route, engine, request, attempt, selected))


@pytest.mark.parametrize("proposed", [None, BASELINE_METHOD_ID])
def test_old_original_calls_keep_default_null_proposal_and_false_flag_bytes(setup, proposed):
    request, attempt = source(proposed)
    before = canonical_json(attempt)
    expected = canonical_json(estimate_observation(attempt))
    ordinary = invoke(setup, "registry", "original", request, attempt, {})
    explicit_false = invoke(setup, "registry", "original", request, attempt, {"originalMethodMissing": False})
    assert canonical_json(ordinary) == canonical_json(explicit_false)
    assert canonical_json(ordinary["raw"]["result"]) == expected
    assert ordinary["requested_method"]["method_id"] == BASELINE_METHOD_ID
    native = engine_adapter.estimate(baseline_bundle(), attempt, request)
    native_false = engine_adapter.estimate(
        baseline_bundle(), attempt, request, {"originalMethodMissing": False}
    )
    assert canonical_json(native) == canonical_json(native_false)
    assert canonical_json(native["raw"]["result"]) == expected
    assert canonical_json(attempt) == before


@pytest.mark.parametrize("engine", ["original", "ecologits"])
def test_valid_live_marker_options_preserve_source_bytes_and_explicit_null_lineage(setup, engine):
    request, attempt = source()
    before = canonical_json([request, attempt])
    result = invoke(setup, "registry", engine, request, attempt, options(engine))
    assert validate_estimation_envelope(result) is result
    assert result["requested_method"] == engine_adapter.identity(definition(engine))
    assert result["view"] == "recalculated" and result["original_method_hash"] is None
    assert result["source"]["attempt_hash"] == payload_hash(attempt)
    assert "original_method_missing" in result["reasons"]
    assert canonical_json([request, attempt]) == before


def ingest_known(setup, engine):
    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    attempt["proposed_method_id"] = engine_adapter.identity(definition(engine))["method_id"]
    response = upload(client, credentials, [request, attempt])
    assert response.status_code == 200, response.text
    assert [row["status"] for row in response.json()["results"]] == ["applied", "applied"], response.text
    return app, company, member, request, attempt


def forged_overlay(company, member, request, attempt, result):
    return SimpleNamespace(
        tenant=company.id,
        owner=member.id,
        family="live",
        record_key=attempt["attempt_id"],
        observation_hash=payload_hash(attempt),
        request_hash=payload_hash(request),
        method_id=result["requested_method"]["method_id"],
        view="recalculated",
        estimate=result,
        source_payload=attempt,
        request_payload=request,
        original_method_hash=None,
        original_method_missing=True,
        history_hash="",
        history_payload=None,
    )


@pytest.mark.parametrize("target", ["original", "ecologits"])
def test_persistence_and_verification_reject_a_valid_wrapper_from_rewritten_known_source(setup, target):
    app, company, member, request, attempt = ingest_known(setup, "original")
    changed = {**deepcopy(attempt), "proposed_method_id": MARKER}
    result = engine_adapter.estimate(definition(target), changed, request, options(target))
    assert validate_estimation_envelope(result) is result
    with app.state.db.transaction(scope=company.origin) as session:
        record = session.get(Observation, (company.id, member.id, "attempt", attempt["attempt_id"]))
        before = canonical_json([record.payload, record.estimate])
        count = session.scalar(select(func.count()).select_from(EngineEstimate))
        rejected(
            lambda: engine_history.persist(
                session, record, result["requested_method"]["method_id"], result, "recalculated"
            ),
            "estimate_lineage_conflict",
        )
        rejected(
            lambda: engine_history.verify_overlay(
                session, forged_overlay(company, member, request, changed, result)
            ),
            "estimate_lineage_conflict",
        )
        assert canonical_json([record.payload, record.estimate]) == before
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == count


@pytest.mark.parametrize("known_engine", ["original", "ecologits"])
def test_marker_with_any_trusted_original_archive_cannot_claim_absent_lineage(setup, known_engine):
    app, company, member, request, attempt = ingest_known(setup, known_engine)
    with app.state.db.transaction(scope=company.origin) as session:
        record = session.get(Observation, (company.id, member.id, "attempt", attempt["attempt_id"]))
        original = method_registry.estimate(
            session, record.payload, request=request, tenant=company.id, owner=member.id
        )
        app.state.service.analytics.methods.persist(session, record, original, "original")
        table = EngineEstimate
        originals = list(
            session.scalars(
                select(table).where(
                    table.tenant == company.id, table.owner == member.id, table.view == "original"
                )
            )
        )
        assert originals
        trusted_bytes = [canonical_json(row.estimate) for row in originals]
        # Model a newer canonical marker revision while retaining its genuine earlier original.
        record.payload = {
            **deepcopy(record.payload),
            "revision": record.revision + 1,
            "proposed_method_id": MARKER,
        }
        record.revision += 1
        record.payload_hash = payload_hash(record.payload)
        record.estimate = {"status": "pending", "reason": "method_unsupported"}
        session.flush()
        result = engine_adapter.estimate(
            definition("ecologits"), record.payload, request, options("ecologits")
        )
        assert validate_estimation_envelope(result) is result
        rejected(
            lambda: engine_history.persist(
                session, record, result["requested_method"]["method_id"], result, "recalculated"
            ),
            "estimate_lineage_conflict",
        )
        rejected(
            lambda: engine_history.verify_overlay(
                session, forged_overlay(company, member, request, record.payload, result)
            ),
            "estimate_lineage_conflict",
        )
        assert [canonical_json(row.estimate) for row in originals] == trusted_bytes
