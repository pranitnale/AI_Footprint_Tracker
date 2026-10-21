from datetime import timedelta
from uuid import uuid4

from conftest import connect, login

from aift import maintenance


def refresh(client, value):
    return client.post("/v1/auth/refresh", json={"refresh_token": value, "operation_id": str(uuid4())})


def test_a_connected_browser_stays_connected_until_it_is_removed(setup):
    # Owner, 13 Oct 2026: members stay connected until they disconnect or an administrator removes
    # them. Before, a browser unused for 30 days had to connect again.
    app, client, _, _, now, _ = setup
    login(app, client)
    first, _ = connect(app, client)

    now[0] += timedelta(days=400)
    maintenance.run(app.state.service)
    second = refresh(client, first["refresh_token"])
    assert second.status_code == 200, second.text

    # A replaced token still revokes the family when replayed within 30 days ...
    replayed = refresh(client, first["refresh_token"])
    assert replayed.status_code == 403
    assert replayed.json()["error"]["code"] == "refresh_reuse_detected"


def test_replaced_refresh_tokens_are_deleted_after_30_days(setup):
    app, client, company, _, now, _ = setup
    login(app, client)
    first, _ = connect(app, client)
    assert refresh(client, first["refresh_token"]).status_code == 200

    now[0] += timedelta(days=31)
    maintenance.run(app.state.service)
    # ... and after 30 days it is gone, so the table does not grow with every refresh.
    assert refresh(client, first["refresh_token"]).status_code == 401
