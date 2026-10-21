"""An explicitly unadmitted live source can later acquire a selected calculation."""

import json
import re
import subprocess
from copy import deepcopy
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from conftest import connect, login
from footprint_contracts import canonical_json
from footprint_estimator import baseline_bundle, estimate_observation
from sqlalchemy import func, select
from test_analytics import observations, upload
from test_historical_usage import auth

from aift import engine_adapter, engine_history
from aift.db import Observation, get
from aift.engine_history import EngineEstimate
from aift.method_history import HistoricalEstimate, RecalculationJob, resolve_estimate
from aift.security import Problem


@pytest.mark.parametrize(
    "engine,site", [("original", "chatgpt"), ("ecologits", "chatgpt"), ("ecologits", "perplexity")]
)
def test_not_admitted_live_source_retains_original_bytes_and_acquires_selected_overlay(setup, engine, site):
    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    request["site"] = site
    attempt["proposed_method_id"] = engine_adapter.MISSING_ADMISSION_METHOD_ID
    reply = upload(client, credentials, [request, attempt])
    assert reply.status_code == 200, reply.text
    assert reply.json()["results"][1]["status"] == "stored_pending_estimate"
    with app.state.db.transaction(readonly=True) as session:
        original = session.get(Observation, (company.id, member.id, "attempt", attempt["attempt_id"]))
        original_bytes = canonical_json([original.payload, original.estimate])
        assert original.estimate["status"] == "pending"
        assert original.estimate["reason"] == "method_unsupported"
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 0
    definition = baseline_bundle() if engine == "original" else engine_adapter.packaged_definition()
    method = engine_adapter.identity(definition)
    selected = client.put(
        "/v1/me/estimation-selection",
        headers=auth(credentials),
        json={
            "preference": engine,
            "selection_revision": 1,
            "method_id": method["method_id"],
            "method_hash": method["method_hash"],
            "operation_id": str(uuid4()),
        },
    )
    assert selected.status_code == 200, selected.text
    identifier = selected.json()["recalculation"]["job_id"]
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        app.state.service.analytics.methods.advance(
            session, get(session, "company", company.id), session.get(RecalculationJob, identifier), 1
        )
    with app.state.db.transaction(readonly=True) as session:
        original = session.get(Observation, (company.id, member.id, "attempt", attempt["attempt_id"]))
        assert canonical_json([original.payload, original.estimate]) == original_bytes
        assert resolve_estimate(session, original)["status"] == "pending"
        result = resolve_estimate(session, original, method["method_id"])["result"]
        assert result["view"] == "recalculated"
        assert result["original_method_hash"] is None
        assert "original_method_missing" in result["reasons"]
        assert result["requested_method"] == method
        assert result["metrics"]["energy"]["value"] is not None
        overlay = session.scalar(select(EngineEstimate))
        assert overlay.original_method_missing is True
        engine_history.verify_overlay(session, overlay)
        broken = SimpleNamespace(
            **{column.name: getattr(overlay, column.name) for column in EngineEstimate.__table__.columns}
        )
        broken.original_method_missing = False
        with pytest.raises(Problem, match="estimate_lineage_conflict"):
            engine_history.verify_overlay(session, broken)
        assert session.scalar(select(func.count()).select_from(HistoricalEstimate)) == 0
        assert session.get(RecalculationJob, identifier).data["status"] == "completed"
    query = "?period=all&calculation_view=recalculated&method_id=" + method["method_id"]
    assert client.get("/v1/me/summary" + query, headers=auth(credentials)).status_code == 200
    retained = client.get("/v1/me/summary?period=all&calculation_view=original", headers=auth(credentials))
    assert retained.status_code == 200


def test_missing_lineage_native_and_client_results_match_without_changing_old_original_calls():
    request, attempt = observations(datetime(2026, 9, 15, 12, tzinfo=UTC))
    old = canonical_json(estimate_observation(attempt))
    assert canonical_json(estimate_observation(attempt, {"originalMethodMissing": False})) == old
    inputs, expected = [], []
    for engine, site in [("original", "chatgpt"), ("ecologits", "chatgpt"), ("ecologits", "perplexity")]:
        req, obs = deepcopy(request), deepcopy(attempt)
        req["site"] = site
        obs["proposed_method_id"] = engine_adapter.MISSING_ADMISSION_METHOD_ID
        definition = baseline_bundle() if engine == "original" else engine_adapter.packaged_definition()
        options = {
            "methodId": engine_adapter.identity(definition)["method_id"],
            "view": "recalculated",
            "originalMethodMissing": True,
        }
        inputs.append({"input": {"family": "live", "request": req, "attempt": obs}, "options": options})
        expected.append(engine_adapter.estimate(definition, obs, req, options))
    script = """
import fs from 'node:fs';
import {createMethodRegistry} from './packages/estimator/src/engines/methods.ts';
import {LocalEstimateExecutor} from './packages/estimator/src/engines/service.ts';
const registry=createMethodRegistry(JSON.parse(fs.readFileSync('config/estimation.build.json','utf8')),JSON.parse(fs.readFileSync('config/estimation.mappings.json','utf8')),JSON.parse(fs.readFileSync('config/estimation.media.json','utf8')));
const executor=new LocalEstimateExecutor(registry), result=[];
for(const row of JSON.parse(fs.readFileSync(0,'utf8'))) result.push(await executor.estimate(row.input,row.options));
process.stdout.write(JSON.stringify(result));
"""
    process = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", script],
        cwd=engine_adapter.ROOT,
        input=json.dumps(inputs),
        text=True,
        capture_output=True,
        timeout=30,
    )
    assert process.returncode == 0, process.stderr

    def compare(left, right, path=""):
        if isinstance(left, dict):
            assert set(left) == set(right), path
            for key in left:
                if key != "execution_origin":
                    compare(left[key], right[key], path + "." + key)
        elif isinstance(left, list):
            assert len(left) == len(right), path
            for a, b in zip(left, right, strict=True):
                compare(a, b, path)
        elif (
            isinstance(left, str)
            and re.fullmatch(r"[0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?", left)
            and not path.endswith("hash")
        ):
            assert float(left) == pytest.approx(float(right), rel=1e-10, abs=1e-16), path
        else:
            assert left == right, path

    compare(json.loads(process.stdout), expected)
    assert canonical_json(estimate_observation(attempt)) == old
