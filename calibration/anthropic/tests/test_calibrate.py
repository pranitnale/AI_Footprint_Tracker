import importlib.util
import json
from pathlib import Path

import httpx2
import pytest

SPEC = importlib.util.spec_from_file_location(
    "calibrate", Path(__file__).parents[1] / "calibrate.py"
)
c = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(c)


def cases():
    return [
        {
            "id": f"synthetic-{n}",
            "text": f"SyntheticMarker {n}",
            "group": "english",
            "split": "training" if n < 4 else "holdout",
            "counts": {"cl100k_base": 4, "o200k_base": 6},
        }
        for n in range(8)
    ]


def client(handler):
    return c.create_client("test-only-placeholder", httpx2.MockTransport(handler))


def test_pinned_corpus_and_plan_require_no_credentials(monkeypatch, capsys):
    monkeypatch.delenv("AIFT_ANTHROPIC_COUNTING_KEY", raising=False)
    monkeypatch.setattr(c, "create_client", lambda *_: pytest.fail("plan created client"))
    assert c.main(["--corpus", str(c.CORPUS), "--model", "claude-fixture-generation-1"]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["status"] == "plan_only"
    assert (result["training"], result["holdout"]) == (300, 100)
    assert result["approved"] is False
    with pytest.raises(c.CalibrationError, match="unapproved_corpus"):
        c.load_corpus(Path("employee-export.json"))
    for model in ("", "claude-latest", "private.example/path", "claude-x\nsecret"):
        with pytest.raises(c.CalibrationError):
            c.validate_model(model)


def test_pins_hold_for_lf_and_crlf_checkouts_but_not_for_changed_content():
    # The corpus pin once held the hash of a Windows CRLF copy, so the plan failed on Linux.
    for path, pin in ((c.CORPUS, c.CORPUS_HASH), (c.ASSETS, c.ASSETS_HASH)):
        lf = path.read_bytes().replace(b"\r\n", b"\n")
        assert c.text_sha256(lf) == pin
        assert c.text_sha256(lf.replace(b"\n", b"\r\n")) == pin
        assert c.text_sha256(lf.replace(b'"', b"'", 1)) != pin


def test_actual_sdk_only_posts_count_endpoint_and_reports_deterministically():
    requests = []

    def respond(request):
        requests.append((request.method, str(request.url), json.loads(request.content)))
        return httpx2.Response(200, json={"input_tokens": 5})

    with client(respond) as sdk:
        first = c.evaluate(
            sdk, "claude-fixture-generation-1", cases(), "2026-09-10", sleep=lambda _: None
        )
        second = c.evaluate(
            sdk, "claude-fixture-generation-1", cases(), "2026-09-10", sleep=lambda _: None
        )
    assert first == second
    assert all(
        method == "POST" and url.endswith("/v1/messages/count_tokens")
        for method, url, _ in requests
    )
    assert all(set(body) == {"model", "messages"} for _, _, body in requests)
    assert first["status"] == "reference_evaluation_complete_unvalidated"
    assert first["profile"]["selected_on_training"] == "cl100k_base"
    assert first["profile"]["runtime_selection_allowed"] is False
    assert first["approved"] is False
    assert "SyntheticMarker" not in json.dumps(first)
    assert "test-only-placeholder" not in json.dumps(first)
    assert c.digest({k: v for k, v in first.items() if k != "report_hash"}) == first["report_hash"]
    assert c.digest(first["profile"]) == first["profile_hash"]
    summary = first["groups"]["holdout"]["english"]["cl100k_base"]
    assert (
        summary["bias_tokens"],
        summary["median_absolute_error"],
        summary["p95_absolute_error"],
    ) == (-1, 1, 1)


def test_transport_blocks_generation_redirects_and_other_hosts_without_sending():
    transport = c.guarded_transport(
        httpx2.MockTransport(lambda _: pytest.fail("forbidden network request"))
    )
    for method, url in (
        ("POST", "https://api.anthropic.com/v1/messages"),
        ("GET", "https://api.anthropic.com/v1/messages/count_tokens"),
        ("POST", "https://other.invalid/v1/messages/count_tokens"),
        ("POST", "https://api.anthropic.com/v1/messages/count_tokens?extra=true"),
    ):
        with pytest.raises(c.CalibrationError, match="non_counting_request_blocked"):
            transport.handle_request(httpx2.Request(method, url))


@pytest.mark.parametrize(
    "status,reason,attempts",
    [
        (401, "authentication_failed", 1),
        (404, "model_or_request_rejected", 1),
        (429, "rate_limited", 3),
        (503, "provider_failed", 3),
    ],
)
def test_failures_are_null_sanitized_bounded_and_never_approved(status, reason, attempts):
    calls = []

    def respond(request):
        calls.append(request)
        return httpx2.Response(
            status, json={"error": {"type": "fixture_error", "message": "PrivateErrorMarker"}}
        )

    with client(respond) as sdk:
        result = c.evaluate(
            sdk, "claude-fixture-generation-1", cases(), "2026-09-10", limit=1, sleep=lambda _: None
        )
    assert len(calls) == attempts
    assert result["results"][0]["reference_input_tokens"] is None
    assert result["results"][0]["reason"] == reason
    assert result["status"] == "incomplete"
    assert result["profile"]["selected_on_training"] is None
    assert "PrivateErrorMarker" not in json.dumps(result)
    assert result["approved"] is False


def test_retries_recover_and_zero_reference_never_divides_by_zero():
    statuses = iter([429, 503, 200])

    def respond(_):
        status = next(statuses)
        return httpx2.Response(
            status,
            json={"input_tokens": 0}
            if status == 200
            else {"error": {"type": "busy", "message": "private"}},
        )

    with client(respond) as sdk:
        result = c.evaluate(
            sdk, "claude-fixture-generation-1", cases(), "2026-09-10", limit=1, sleep=lambda _: None
        )
    assert result["results"][0]["attempts"] == 3
    assert result["results"][0]["reference_input_tokens"] == 0
    assert result["training_metrics"]["cl100k_base"]["mean_relative_error"] is None
    assert result["status"] == "incomplete"


def test_holdout_cannot_select_candidate_and_models_keep_separate_profiles():
    def evaluate(model, holdout):
        n = 0

        def respond(_):
            nonlocal n
            n += 1
            return httpx2.Response(200, json={"input_tokens": 4 if n <= 4 else holdout})

        with client(respond) as sdk:
            return c.evaluate(sdk, model, cases(), "2026-09-10", sleep=lambda _: None)

    one = evaluate("claude-fixture-generation-1", 6)
    two = evaluate("claude-fixture-generation-1", 100)
    modern = evaluate("claude-fixture-generation-2", 6)
    assert (
        one["profile"]["selected_on_training"]
        == two["profile"]["selected_on_training"]
        == "cl100k_base"
    )
    assert len({one["profile_hash"], two["profile_hash"], modern["profile_hash"]}) == 3
    assert all(not result["approved"] for result in (one, two, modern))


def test_execute_refuses_missing_environment_key_and_existing_report(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("AIFT_ANTHROPIC_COUNTING_KEY", raising=False)
    output = tmp_path / "report.json"
    args = [
        "--corpus",
        str(c.CORPUS),
        "--model",
        "claude-fixture-generation-1",
        "--execute",
        "--output",
        str(output),
    ]
    assert c.main(args) == 2
    assert not output.exists()
    output.write_text("preserved")
    assert c.main(args) == 2
    assert output.read_text() == "preserved"
    assert "test-only-placeholder" not in capsys.readouterr().out


def test_unknown_credential_arguments_are_not_echoed(capsys):
    with pytest.raises(SystemExit) as outcome:
        c.main(
            [
                "--corpus",
                str(c.CORPUS),
                "--model",
                "claude-fixture-generation-1",
                "--api-key",
                "AccidentalPrivateKeyMarker",
            ]
        )
    assert outcome.value.code == 2
    output = capsys.readouterr()
    assert "AccidentalPrivateKeyMarker" not in output.out + output.err
    assert "invalid_arguments" in output.err


def test_an_empty_case_is_recorded_without_a_request_and_does_not_stop_the_run():
    # 15 Oct 2026: the API answers 400 to an empty message, and the corpus's first case is empty,
    # so every live run stopped at its first case as model_or_request_rejected.
    requested = []

    def respond(request):
        requested.append(json.loads(request.content)["messages"][0]["content"])
        return httpx2.Response(200, json={"input_tokens": 7})

    corpus = cases()
    corpus[0] = {**corpus[0], "text": ""}
    with client(respond) as sdk:
        result = c.evaluate(
            sdk, "claude-fixture-generation-1", corpus, "2026-10-15", sleep=lambda _: None
        )
    assert "" not in requested and len(requested) == len(corpus) - 1
    assert result["results"][0]["reason"] == c.EMPTY_TEXT
    assert result["results"][0]["reference_input_tokens"] is None
    assert result["status"] == "reference_evaluation_complete_unvalidated"
    assert result["training_metrics"]["o200k_base"]["n"] == 3
