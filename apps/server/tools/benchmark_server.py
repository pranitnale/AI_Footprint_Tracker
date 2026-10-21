"""Opt-in PostgreSQL P01-P03 harness. Default mode only prints the unexecuted plan."""

import argparse
import json
import os
import platform
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import NAMESPACE_URL, uuid4, uuid5

SERVER = Path(__file__).resolve().parents[1]
ROOT = SERVER.parents[1]
sys.path[:0] = [
    str(SERVER),
    str(ROOT / "packages/contracts/python"),
    str(ROOT / "packages/estimator/python"),
    str(SERVER / "tests"),
]


def plan(records):
    return {
        "status": "unverified",
        "execution": "not_started",
        "records": records,
        "users": 500,
        "installations_per_user": 2,
        "database": "isolated PostgreSQL schema on an explicitly approved runtime",
        "gates": {
            "P02": "50 observations/second,100-record batches,p95<=2s",
            "P03": "1M/10M retained records,indexed dashboard p95<=2s",
        },
        "requirements": [
            "AIFT_BENCH_DATABASE_URL points to an approved PostgreSQL test service",
            "--execute --confirm-isolated-schema-writes",
            "Available disk/memory appropriate to the selected retained-history size",
            "Record reference database hardware with published results",
        ],
        "local_runtime": "Do not run the denied Windows PostgreSQL executable or an alternate startup route",
    }


def percentile(values):
    values = sorted(values)
    return values[max(0, int(len(values) * 0.95 + 0.999999) - 1)] if values else None


def execute(args):
    from alembic import command
    from alembic.config import Config
    from cryptography.fernet import Fernet
    from fastapi.testclient import TestClient
    from footprint_contracts import payload_hash, validate_observation
    from footprint_estimator import estimate_observation
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url
    from test_analytics import observations

    from aift.config import Settings
    from aift.db import TABLES, Observation, get, put
    from aift.main import create_app
    from aift.security import digest, instant, token

    source = os.environ.get("AIFT_BENCH_DATABASE_URL", "")
    if not source.startswith("postgresql") or not args.confirm_isolated_schema_writes:
        raise RuntimeError("approved_postgresql_and_explicit_confirmation_required")
    schema = "aift_benchmark_" + uuid4().hex
    admin_engine = create_engine(source)
    with admin_engine.begin() as connection:
        connection.execute(text('CREATE SCHEMA "' + schema + '"'))
    scoped = make_url(source).update_query_dict({"options": "-csearch_path=" + schema})
    application = None
    try:
        settings = Settings(
            database_url=scoped.render_as_string(hide_password=False),
            environment="test",
            mail_adapter="fake",
            encryption_key=Fernet.generate_key().decode(),
            lookup_key=token(),
            deletion_signing_key=token(),
            member_capacity=500,
            domain_policy="one_active",
            routing_verified=True,
        )
        with tempfile.TemporaryDirectory() as directory:
            from dataclasses import asdict, replace

            settings = replace(settings, deletion_journal_path=str(Path(directory) / "journal"))
            settings_path = Path(directory) / "settings.json"
            settings_path.write_text(json.dumps(asdict(settings)))
            os.environ["AIFT_SETTINGS_FILE"] = str(settings_path)
            configuration = Config(str(SERVER / "alembic.ini"))
            configuration.set_main_option("script_location", str(SERVER / "migrations"))
            command.upgrade(configuration, "head")
            application = create_app(settings)
            service = application.state.service
            now = datetime.now(timezone.utc)
            origin = "https://benchmark.example.org"
            accounts = []
            with service.db.transaction(scope="benchmark-setup") as session:
                company = put(
                    session,
                    "company",
                    str(uuid4()),
                    {
                        "name": "Synthetic benchmark",
                        "slug": "benchmark",
                        "domain": "example.org",
                        "origin": origin,
                        "status": "active",
                        "timezone": "UTC",
                        "pause_mode": "user_controlled",
                        "company_sharing": "threshold",
                        "capacity": 500,
                        "retention_months": 6,
                        "policy_version": "1.0.0",
                        "epoch": 0,
                        "version": 1,
                        "plan_id": "benchmark",
                        "plan_version": 1,
                    },
                )
                for number in range(500):
                    member = service.member(session, company, f"fixture-{number}@example.org", number == 0)
                    devices = []
                    for browser in ("chrome", "firefox"):
                        device = put(
                            session,
                            "device",
                            str(uuid4()),
                            {
                                "browser_family": browser,
                                "status": "active",
                                "reconnect": digest(token()),
                                "created_at": instant(now - timedelta(days=121)),
                                "last_reporting_at": None,
                            },
                            company.id,
                            member.id,
                        )
                        put(
                            session,
                            "era",
                            str(uuid4()),
                            {
                                "device": device.id,
                                "start": instant(now - timedelta(days=121)),
                                "end": None,
                                "policy_version": "1.0.0",
                            },
                            company.id,
                            member.id,
                        )
                        devices.append(device.id)
                    accounts.append((member.id, devices))
                raw_session, csrf = service.session(
                    session, company, get(session, "member", accounts[0][0], company.id)
                )
            request_count = args.records // 2
            attempt_count = args.records - request_count
            started = time.perf_counter()
            for kind, count in (("request", request_count), ("attempt", attempt_count)):
                for offset in range(0, count, 500):
                    canonical_rows = []
                    history_rows = []
                    receipt_rows = []
                    for index in range(offset, min(offset + 500, count)):
                        parent = index % request_count
                        owner, devices = accounts[parent % 500]
                        device = devices[(parent // 500) % 2]
                        occurred = now - timedelta(days=parent % 120, seconds=1)
                        request, attempt = observations(occurred)
                        request_id = str(uuid5(NAMESPACE_URL, f"{schema}:request:{parent}"))
                        request.update(
                            request_id=request_id,
                            site=("chatgpt", "claude", "gemini", "perplexity")[parent % 4],
                        )
                        attempt.update(
                            request_id=request_id,
                            attempt_id=str(uuid5(NAMESPACE_URL, f"{schema}:attempt:{index}")),
                        )
                        record = request if kind == "request" else attempt
                        validate_observation(record)
                        record_id = record["request_id"] if kind == "request" else record["attempt_id"]
                        hashed = payload_hash(record)
                        estimate = (
                            {"status": "not_applicable"}
                            if kind == "request"
                            else {"status": "available", "result": estimate_observation(record)}
                        )
                        canonical_rows.append(
                            {
                                "tenant": company.id,
                                "owner": owner,
                                "kind": kind,
                                "id": record_id,
                                "device": device,
                                "revision": 1,
                                "parent": None if kind == "request" else request_id,
                                "parent_kind": None if kind == "request" else "request",
                                "stable_key": None,
                                "payload_hash": hashed,
                                "occurred_at": instant(occurred),
                                "site": request["site"],
                                "model": None,
                                "conversation": request["conversation_key"],
                                "payload": record,
                                "estimate": estimate,
                                "status": "current",
                            }
                        )
                        key = digest(company.id + owner + kind + record_id + ":1")
                        history_rows.append(
                            {
                                "id": key,
                                "tenant": company.id,
                                "owner": owner,
                                "record_kind": kind,
                                "record_id": record_id,
                                "data": {
                                    "record": record,
                                    "estimate": estimate,
                                    "payload_hash": hashed,
                                    "kind": kind,
                                    "record_id": record_id,
                                },
                            }
                        )
                        receipt_rows.append(
                            {
                                "id": key,
                                "tenant": company.id,
                                "owner": owner,
                                "record_kind": kind,
                                "record_id": record_id,
                                "data": {
                                    "kind": kind,
                                    "record_id": record_id,
                                    "revision": 1,
                                    "canonical_id": record_id,
                                    "payload_hash": hashed,
                                    "status": "applied",
                                    "error_code": None,
                                    "retryable": False,
                                    "server_record_version": 1,
                                    "estimate_status": estimate["status"],
                                },
                            }
                        )
                    with service.db.transaction(scope=origin) as session:
                        session.bulk_insert_mappings(Observation, canonical_rows)
                        session.bulk_insert_mappings(TABLES["revision"], history_rows)
                        session.bulk_insert_mappings(TABLES["receipt"], receipt_rows)
            with service.db.transaction(scope=origin) as session:
                tenant = get(session, "company", company.id)
                tenant.data = {**tenant.data, "aggregate_status": "rebuilding"}
            from aift.maintenance import rebucket

            while True:
                with service.db.transaction(scope=origin) as session:
                    if rebucket(service, session, get(session, "company", company.id)):
                        break
            seed_seconds = time.perf_counter() - started
            with service.db.transaction(scope=origin) as session:
                raw_session, csrf = service.session(session, get(session, "company", company.id), get(session, "member", accounts[0][0], company.id))
            client = TestClient(application, base_url=origin)
            client.headers.update(
                {"Origin": origin, "Cookie": "__Host-aift=" + raw_session, "X-CSRF-Token": csrf}
            )
            query_times = []
            for index in range(args.samples):
                before = time.perf_counter()
                response = client.get("/v1/admin/summary", params={"period": "all" if index % 2 else "month"})
                query_times.append(time.perf_counter() - before)
                if response.status_code != 200:
                    raise RuntimeError("benchmark_query_failed")
            with service.db.transaction(readonly=True) as session:
                storage = session.execute(
                    text(
                        "SELECT coalesce(sum(pg_total_relation_size(c.oid)),0),coalesce(sum(pg_indexes_size(c.oid)),0) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=:schema AND c.relkind='r'"
                    ),
                    {"schema": schema},
                ).one()
            # The burst uses real enrollment proof, schema validation and durable ACK paths, never bulk seed timing.
            from conftest import connect

            credential, _ = connect(application, client)
            batches = []
            for index in range(args.batches):
                records = []
                for _ in range(50):
                    records.extend(observations(datetime.now(timezone.utc)))
                batches.append(
                    {
                        "schema_version": "3.0.0",
                        "batch_id": str(uuid4()),
                        "sent_at": instant(),
                        "client_version": "0.1.0",
                        "deletion_epoch": 0,
                        "records": records,
                    }
                )

            def send(batch):
                with TestClient(application, base_url=origin) as sender:
                    before = time.perf_counter()
                    result = sender.post(
                        "/v1/usage/batches",
                        json=batch,
                        headers={"Origin": origin, "Authorization": "Bearer " + credential["access_token"]},
                    )
                    return time.perf_counter() - before, result.status_code, result.json()

            futures = []
            burst_start = time.perf_counter()
            with ThreadPoolExecutor(max_workers=4) as executor:
                for index, batch in enumerate(batches):
                    wait = burst_start + index * 2 - time.perf_counter()
                    if wait > 0:
                        time.sleep(wait)
                    futures.append(executor.submit(send, batch))
                results = [future.result() for future in futures]
            ingest = [duration for duration, status, _ in results if status == 200]
            applied = sum(
                sum(
                    row["status"] in {"applied", "stored_pending_estimate"}
                    for row in payload.get("results", [])
                )
                for _, status, payload in results
                if status == 200
            )
            return {
                "status": "measured" if args.records in {1_000_000, 10_000_000} else "smoke_only",
                "database": "PostgreSQL",
                "retained_canonical_records": args.records,
                "users": 500,
                "installations_per_user": 2,
                "seed_seconds": seed_seconds,
                "query_samples": len(query_times),
                "query_p95_seconds": percentile(query_times),
                "ingestion_p95_seconds": percentile(ingest),
                "scheduled_observations_per_second": 50,
                "applied_observations": applied,
                "overload_responses": sum(status == 429 for _, status, _ in results),
                "failed_responses": sum(status not in {200, 429} for _, status, _ in results),
                "database_bytes": int(storage[0]),
                "index_bytes": int(storage[1]),
                "load_generator": {
                    "platform": platform.platform(),
                    "cpu_count": os.cpu_count(),
                    "python": platform.python_version(),
                },
                "gates": {
                    "P02": bool(ingest) and percentile(ingest) <= 2 and applied == args.batches * 100,
                    "P03": percentile(query_times) <= 2,
                },
                "limits": [
                    "In-process ASGI transport excludes browser/network latency",
                    "Seed identities are synthetic; no live email",
                    "Reference database hardware must accompany this report",
                    "This is not physical energy validation",
                ],
            }
    finally:
        if application:
            application.state.db.engine.dispose()
        with admin_engine.begin() as connection:
            connection.execute(text('DROP SCHEMA "' + schema + '" CASCADE'))
        admin_engine.dispose()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--records", type=int, default=1_000_000)
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--batches", type=int, default=15)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-isolated-schema-writes", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if (
        args.records < 1000
        or args.records > 10_000_000
        or not 10 <= args.samples <= 1000
        or not 1 <= args.batches <= 120
    ):
        parser.error("invalid workload bounds")
    report = execute(args) if args.execute else plan(args.records)
    value = json.dumps(report, indent=2)
    if args.output:
        args.output.write_text(value, encoding="utf-8")
    print(value)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "error": "benchmark_failed",
                    "details": "No database credentials or raw exception details are emitted.",
                }
            )
        )
        raise SystemExit(1) from None
