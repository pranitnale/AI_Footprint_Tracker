"""Synthetic TestClient transport for the extension's actual enrollment and method client."""

import json
import sys
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace


def main():
    root = Path(__file__).resolve().parents[3]
    for path in (
        "apps/server",
        "apps/server/tests",
        "packages/contracts/python",
        "packages/estimator/python",
    ):
        sys.path.insert(0, str(root / path))

    from conftest import login, setup
    from fastapi.testclient import TestClient
    from test_method_delivery import signed

    from aift.method_registry import install

    # The fixture reads optional feature markers from pytest's request; outside pytest there
    # are none, so the operator switches keep their defaults (off).
    no_markers = SimpleNamespace(node=SimpleNamespace(get_closest_marker=lambda _name: None))
    app, admin, company, member, now, settings = setup.__wrapped__(Path(sys.argv[1]), no_markers)
    now[0] = datetime.now(UTC)
    envelope, public, private = signed(now[0], "signed-runtime-api-v1")
    app.state.service.settings = replace(settings, method_public_key=public)
    with app.state.db.transaction(scope="method-install") as session:
        install(session, envelope, public, now[0], approved_by="synthetic-runtime-review")
    login(app, admin)
    # The extension reaches a hosted organization at the service's one address, as a browser
    # extension does: the server finds the organization from the work email, then from the token.
    service_origin = settings.registration_origin
    extension = TestClient(app, base_url=service_origin)
    extension.headers["Origin"] = settings.extension_origins[0]
    print(
        json.dumps({"ready": True, "origin": service_origin, "methodId": envelope["bundle"]["method_id"]}),
        flush=True,
    )
    for line in sys.stdin:
        request = json.loads(line)
        now[0] = datetime.now(UTC)
        if request.get("advance_worker"):
            from aift.maintenance import run

            run(app.state.service)
            result = {"advanced": True}
            status = 200
        elif request.get("read_code"):
            # The extension connects with an email code; the fake mail adapter keeps the last one.
            result = {"code": app.state.mail.messages[-1]["code"]}
            status = 200
        else:
            headers = request.get("headers", {})
            response = extension.request(
                request["method"], request["path"], headers=headers, json=request.get("body")
            )
            result, status = response.json(), response.status_code
        print(json.dumps({"id": request["id"], "status": status, "body": result}), flush=True)
    extension.close()
    admin.close()


if __name__ == "__main__":
    main()
