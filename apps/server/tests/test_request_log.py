import json
import logging

from aift import request_log


class Lines(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines = []

    def emit(self, record):
        self.lines.append(json.loads(record.getMessage()))


def capture():
    handler = Lines()
    request_log.LOGGER.addHandler(handler)
    return handler


def test_every_request_leaves_one_traceable_line_without_personal_data(setup):
    # Owner, 13 Oct 2026: errors must be traceable from the reference a person reports, without
    # IP addresses or anything the person sent.
    app, client, _, _, _, _ = setup
    handler = capture()
    try:
        response = client.post(
            "/v1/auth/otp/request?email=secret%40example.org",
            json={"purpose": "login", "email": "secret@example.org", "dispatch_id": "not-a-uuid", "registration_id": None},
        )
        assert response.status_code == 422
        reference = response.json()["error"]["correlation_id"]
        assert response.headers["x-request-id"] == reference
        client.get("/health/ready")
    finally:
        request_log.LOGGER.removeHandler(handler)
    [line] = handler.lines  # a passing health check is not logged
    assert line["id"] == reference
    assert line["code"] == "invalid_payload"
    assert line["path"] == "/v1/auth/otp/request"
    assert line["method"] == "POST" and line["status"] == 422 and line["origin"] == "same_site"
    assert set(line) == {"id", "code", "at", "method", "host", "path", "status", "ms", "origin"}
    assert "secret" not in json.dumps(line)


def test_a_server_error_names_where_it_failed_but_not_its_message(setup, monkeypatch):
    app, client, _, _, _, _ = setup
    service = app.state.service

    def broken(*args, **kwargs):
        raise KeyError("member@example.org")

    monkeypatch.setattr(service, "policy", broken)
    handler = capture()
    try:
        response = client.get("/v1/public/config")
    finally:
        request_log.LOGGER.removeHandler(handler)
    assert response.status_code == 500
    [line] = handler.lines
    assert line["id"] == response.json()["error"]["correlation_id"] == response.headers["x-request-id"]
    assert line["code"] == "internal_error"
    assert line["exception"] == "KeyError"
    assert any("test_request_log.py" in frame and "broken" in frame for frame in line["frames"])
    assert "member@example.org" not in json.dumps(line)


def test_log_files_rotate_daily_and_keep_14_days(tmp_path):
    # The daily files and their deletion are tested in test_worker_safety.py.
    path = str(tmp_path / "requests.log")
    request_log.configure(path)
    try:
        [handler] = [h for h in request_log.LOGGER.handlers if getattr(h, "aift_path", None) == path]
        assert isinstance(handler, request_log.DailyFiles) and handler.retention_days == 14
    finally:
        for h in list(request_log.LOGGER.handlers):
            if getattr(h, "aift_path", None) == path:
                request_log.LOGGER.removeHandler(h)
                h.close()
