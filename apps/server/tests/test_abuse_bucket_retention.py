from datetime import timedelta

from aift.db import rows
from aift.maintenance import run


def test_abuse_buckets_are_deleted_one_day_after_their_last_request(setup):
    app, _client, _company, _admin, now, _settings = setup
    service = app.state.service
    with app.state.db.transaction() as s:
        service.rate(s, "contact:old-peer", 5, 3600)
    now[0] += timedelta(hours=23)
    with app.state.db.transaction() as s:
        service.rate(s, "contact:recent-peer", 5, 3600)
        assert len(rows(s, "rate")) == 2

    # Within a day of each bucket's last request nothing is deleted.
    run(service)
    with app.state.db.transaction(readonly=True) as s:
        assert len(rows(s, "rate")) == 2

    now[0] += timedelta(hours=1, seconds=1)
    run(service)
    with app.state.db.transaction(readonly=True) as s:
        remaining = rows(s, "rate")
    assert len(remaining) == 1
    assert remaining[0].id == service.secrets.keyed("rate", "contact:recent-peer")
