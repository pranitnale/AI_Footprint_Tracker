"""
Profiling harness for the summary endpoints. Not part of the suite (the file name does not match
test_*.py); run it on purpose, for example on the test server:

    PROF_SCALE=heavy PROF_DETAIL=1 uv run --frozen pytest -q -s -p no:cacheprovider tests/prof_summaries.py

PROF_SCALE picks the organization: default (organization_dataset.build), big (13 installations,
about 4,600 saved messages) or heavy (5 installations of about 300 live records and 2,000 saved
messages each). One member chooses EcoLogits in the extension's settings, so their own summary is
the recalculated view, as for a person with that choice on production. Each request runs once under
cProfile and three times without; the fastest of those is the one to compare.
"""

import cProfile
import io
import os
import pstats
import time
from collections import Counter

from organization_dataset import auth, build, choose_ecologits, eco
from sqlalchemy import event, text

MONTH = {"period": "custom", "start": "2026-08-11", "end": "2026-09-11"}
SCALES = {
    "default": {},
    "big": {"members": 12, "live_per_member": 60, "conversations_per_member": 16, "messages": 24},
    "heavy": {"members": 4, "live_per_member": 300, "conversations_per_member": 50, "messages": 40},
}


def test_profile(setup):
    app = setup[0]
    scale = os.environ.get("PROF_SCALE", "default")
    started = time.perf_counter()
    # Many sign-ins in one simulated minute would hit the sign-in rate limit.
    app.state.service.rate = lambda *args, **kwargs: None
    admin, people = build(setup, **SCALES[scale])
    owner, oc = people[0]
    member, mc = people[2]
    selector, sc = people[3]
    choose_ecologits(app, selector, sc)
    print(f"\nbuild ({scale}) {time.perf_counter() - started:.1f}s, installations {len(people)}")
    with app.state.db.engine.connect() as connection:
        for label, where in (
            ("whole", ""),
            ("owner", "AND owner = 'x'"),
            ("site", "AND site = 'claude'"),
            ("model", "AND model = 'm'"),
        ):
            plan = connection.execute(
                text(
                    "EXPLAIN QUERY PLAN SELECT * FROM daily_usage_rollups WHERE tenant = 't' "
                    f"AND day >= '2026-08-11' AND day < '2026-09-11' {where}"
                )
            ).all()
            print("rollup plan", label, [row[-1] for row in plan])
    recalculated = {"calculation_view": "recalculated", "method_id": eco()["method_id"]}
    cases = [
        ("me 30 days", owner, "/v1/me/summary", MONTH, oc),
        ("me 30 days recalculated", owner, "/v1/me/summary", {**MONTH, **recalculated}, oc),
        ("me 30 days, EcoLogits chosen", selector, "/v1/me/summary", MONTH, sc),
        ("me this month", owner, "/v1/me/summary", {"period": "month"}, oc),
        ("company 30 days", member, "/v1/company/summary", MONTH, mc),
        ("company 30 days splits=none", member, "/v1/company/summary", {**MONTH, "splits": "none"}, mc),
        ("admin 30 days", admin, "/v1/admin/summary", MONTH, None),
        ("admin 30 days splits=none", admin, "/v1/admin/summary", {**MONTH, "splits": "none"}, None),
        ("admin all time", admin, "/v1/admin/summary", {"period": "all"}, None),
        ("admin people 30 days", admin, "/v1/admin/people", MONTH, None),
    ]
    engine = app.state.db.engine
    stats = {"n": 0, "t": 0.0, "kinds": Counter(), "ktime": Counter()}

    def before(conn, cursor, sql, parameters, context, executemany):
        conn.info["t"] = time.perf_counter()

    def after(conn, cursor, sql, parameters, context, executemany):
        elapsed = time.perf_counter() - conn.info.pop("t")
        stats["n"] += 1
        stats["t"] += elapsed
        head = " ".join(sql.split())[:110]
        stats["kinds"][head] += 1
        stats["ktime"][head] += elapsed

    event.listen(engine, "before_cursor_execute", before)
    event.listen(engine, "after_cursor_execute", after)
    only = os.environ.get("PROF_ONLY")
    for name, client, path, params, credentials in cases:
        if only and only not in name:
            continue
        plain = []
        for attempt in ("profiled", "plain", "plain", "plain"):
            stats.update(n=0, t=0.0, kinds=Counter(), ktime=Counter())
            profiler = cProfile.Profile()
            started = time.perf_counter()
            if attempt == "profiled":
                profiler.enable()
            response = client.get(path, params=params, headers=auth(credentials) if credentials else {})
            profiler.disable()
            elapsed = time.perf_counter() - started
            assert response.status_code == 200, response.text
            if attempt == "plain":
                plain.append(elapsed)
            if attempt == "profiled" or len(plain) == 3:
                # On a shared test server one run can take several times as long; the fastest of
                # three is the comparable figure, the slowest shows the spread.
                timing = (
                    f"{elapsed:.2f}s" if attempt == "profiled" else f"{min(plain):.2f}s (max {max(plain):.2f}s)"
                )
                print(
                    f"\n=== {name} [{attempt}] {timing}, {stats['n']} statements, "
                    f"{stats['t']:.2f}s in SQL, {len(response.content)} bytes"
                )
            if attempt == "profiled" and os.environ.get("PROF_DETAIL"):
                for head, seconds in stats["ktime"].most_common(8):
                    print(f"   sql {stats['kinds'][head]:5d}x {seconds:.3f}s  {head}")
                out = io.StringIO()
                profile = pstats.Stats(profiler, stream=out)
                profile.sort_stats("cumulative").print_stats("aift", 30)
                profile.sort_stats("tottime").print_stats(25)
                lines = out.getvalue().replace(os.path.dirname(os.getcwd()), "").splitlines()
                print("\n".join(line[:180] for line in lines if line.strip()))
