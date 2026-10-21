"""Malformed calculation filters cannot silently export a different method."""

import pytest
from test_historical_usage import auth, page, paired, send


@pytest.mark.parametrize(
    "query,code",
    [
        ({"calculation_view": "typo"}, "unsupported_filter"),
        ({"method_id": "uninstalled-method"}, "unsupported_filter"),
        ({"calculation_view": "original", "method_id": "uninstalled-method"}, "unsupported_filter"),
        ({"method_id": ""}, "unsupported_filter"),
        ({"calculation_view": "original", "method_id": ""}, "unsupported_filter"),
        ({"calculation_view": "recalculated", "method_id": ""}, "method_required"),
    ],
)
def test_history_export_rejects_invalid_calculation_filters(setup, query, code):
    _, client, _, _, now, credentials = paired(setup)
    assert send(client, credentials, page(now[0])).status_code == 200
    valid = client.get("/v1/me/history/export", headers=auth(credentials))
    assert valid.status_code == 200
    assert len(valid.json()["records"]) == 1
    assert valid.json()["records"][0]["resources"]
    response = client.get("/v1/me/history/export", headers=auth(credentials), params=query)
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == code
