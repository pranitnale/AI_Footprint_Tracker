"""Maintainer-only counting reference evaluation. No generation or runtime promotion."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import os
import re
import statistics
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "calibration/tokenizer-golden.json"
# Both pins are SHA-256 of the committed (LF) file. See text_sha256 for why CRLF copies match too.
CORPUS_HASH = "5e11e36e4a0b7f11dc300ded8f5b69dc75002f9fe5607740230773b1ca033258"
ASSETS = ROOT / "packages/tokenizers/src/assets.json"
ASSETS_HASH = "44bb1bc74359d4245552642a7c355e7ba9c6f4dc3a0d620d468334db020dd01c"
SDK_VERSION = "1.4.0"
PROFILES = ("cl100k_base", "o200k_base")
EMPTY_TEXT = "empty_text_not_requested"
MODEL = re.compile(r"claude-[a-z0-9]+(?:-[a-z0-9]+)*\Z")


class CalibrationError(Exception):
    """Only fixed codes may cross the CLI error boundary."""


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # Do not echo an accidentally supplied credential or private path from invalid arguments.
        self.exit(2, '{"status":"blocked","reason":"invalid_arguments"}\n')


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def text_sha256(content: bytes):
    """SHA-256 of a JSON file with CRLF line endings read as LF.

    Git checks these files out with CRLF on Windows (core.autocrlf) and LF elsewhere, so a hash of
    the raw bytes depended on the machine. JSON cannot hold a raw carriage return inside a string,
    so a CRLF in the file is always a line ending and rewriting it changes no content.
    """
    return hashlib.sha256(content.replace(b"\r\n", b"\n")).hexdigest()


def load_corpus(path: Path):
    # Only the reviewed synthetic corpus is eligible. Arbitrary employee files cannot opt in.
    if path.resolve() != CORPUS.resolve():
        raise CalibrationError("unapproved_corpus")
    content = path.read_bytes()
    if text_sha256(content) != CORPUS_HASH:
        raise CalibrationError("corpus_hash_mismatch")
    if text_sha256(ASSETS.read_bytes()) != ASSETS_HASH:
        raise CalibrationError("candidate_assets_changed")
    corpus = json.loads(content)
    cases = corpus["cases"]
    if (
        len(cases) < 400
        or len({item["id"] for item in cases}) != len(cases)
        or sum(item["split"] == "holdout" for item in cases) < math.ceil(len(cases) / 4)
        or not any(item["split"] == "training" for item in cases)
    ):
        raise CalibrationError("invalid_split")
    return cases


def validate_model(model):
    if not MODEL.fullmatch(model) or "latest" in model.split("-") or len(model) > 120:
        raise CalibrationError("explicit_model_required")


def plan(model, cases):
    validate_model(model)
    return {
        "status": "plan_only",
        "endpoint": "https://api.anthropic.com/v1/messages/count_tokens",
        "model": model,
        "sdk_version": SDK_VERSION,
        "corpus_sha256": CORPUS_HASH,
        "corpus_license": "MIT",
        "corpus_origin": "project_authored_synthetic",
        "cases": len(cases),
        "training": sum(case["split"] == "training" for case in cases),
        "holdout": sum(case["split"] == "holdout" for case in cases),
        "request_shape": "single_user_text",
        "runtime_selection_allowed": False,
        "approved": False,
    }


def guarded_transport(inner):
    import httpx2

    class CountOnlyTransport(httpx2.BaseTransport):
        def handle_request(self, request):
            if (
                request.method != "POST"
                or str(request.url) != "https://api.anthropic.com/v1/messages/count_tokens"
            ):
                raise CalibrationError("non_counting_request_blocked")
            return inner.handle_request(request)

        def close(self):
            inner.close()

    return CountOnlyTransport()


def create_client(key, transport=None):
    import anthropic
    import httpx2

    # SDK/HTTP debug output can include bodies or authentication headers.
    for name in ("anthropic", "httpx2", "httpcore"):
        logger = logging.getLogger(name)
        logger.handlers = [logging.NullHandler()]
        logger.propagate = False
        logger.disabled = True
    http = httpx2.Client(
        transport=guarded_transport(transport or httpx2.HTTPTransport(retries=0, trust_env=False)),
        follow_redirects=False,
        trust_env=False,
        timeout=30,
    )
    return anthropic.Anthropic(
        api_key=key,
        base_url="https://api.anthropic.com",
        http_client=http,
        max_retries=0,
    )


def request_count(client, model, text, sleep=time.sleep):
    import anthropic

    for attempt in range(3):
        try:
            value = client.messages.count_tokens(
                model=model, messages=[{"role": "user", "content": text}]
            ).input_tokens
            if type(value) is not int or not 0 <= value <= 9223372036854775807:
                return None, "invalid_reference_count", attempt + 1, False
            return value, None, attempt + 1, False
        except anthropic.APIStatusError as error:
            code = error.status_code
            if code in (401, 403):
                return None, "authentication_failed", attempt + 1, True
            if code in (400, 404, 422):
                return None, "model_or_request_rejected", attempt + 1, True
            retry = code == 429 or code >= 500
            reason = "rate_limited" if code == 429 else "provider_failed"
        except (anthropic.APIConnectionError, anthropic.APITimeoutError):
            retry, reason = True, "transport_failed"
        except Exception:
            return None, "reference_failed", attempt + 1, True
        if not retry or attempt == 2:
            return None, reason, attempt + 1, False
        sleep(2**attempt)
    raise AssertionError("unreachable")


def metrics(rows, profile):
    pairs = [
        (row["candidate_counts"][profile], row["reference_input_tokens"])
        for row in rows
        if row["reference_input_tokens"] is not None
    ]
    if not pairs:
        return {
            "n": 0,
            "bias_tokens": None,
            "median_absolute_error": None,
            "p95_absolute_error": None,
            "mean_absolute_error": None,
            "mean_relative_error": None,
            "relative_n": 0,
        }
    errors = [candidate - reference for candidate, reference in pairs]
    absolute = sorted(abs(value) for value in errors)
    relative = [(candidate - ref) / ref for candidate, ref in pairs if ref > 0]
    return {
        "n": len(pairs),
        "bias_tokens": statistics.mean(errors),
        "median_absolute_error": statistics.median(absolute),
        "p95_absolute_error": absolute[math.ceil(len(absolute) * 0.95) - 1],
        "mean_absolute_error": statistics.mean(absolute),
        "mean_relative_error": statistics.mean(relative) if relative else None,
        "relative_n": len(relative),
    }


def report(model, cases, rows, evaluation_date):
    base = plan(model, cases)
    complete = len(rows) == len(cases) and all(row["reason"] in (None, EMPTY_TEXT) for row in rows)
    training = [row for row in rows if row["split"] == "training"]
    training_complete = len(training) == base["training"] and all(
        row["reason"] in (None, EMPTY_TEXT) for row in training
    )
    training_metrics = {profile: metrics(training, profile) for profile in PROFILES}
    selected = (
        min(
            PROFILES,
            key=lambda profile: (training_metrics[profile]["mean_absolute_error"], profile),
        )
        if training_complete
        else None
    )
    groups = {}
    for split in ("training", "holdout"):
        split_rows = [row for row in rows if row["split"] == split]
        groups[split] = {
            group: {
                profile: metrics([row for row in split_rows if row["group"] == group], profile)
                for profile in PROFILES
            }
            for group in sorted({case["group"] for case in cases if case["split"] == split})
        }
    profile = {
        "format_version": 1,
        "model": model,
        "evaluation_date": evaluation_date,
        "sdk_version": SDK_VERSION,
        "corpus_sha256": CORPUS_HASH,
        "candidate_assets_sha256": ASSETS_HASH,
        "reference_evidence_hash": digest(rows),
        "selected_on_training": selected,
        "fitting": "none",
        "candidate_scope": "supplied_user_text_only",
        "reference_scope": "structured_input_count_estimate_including_envelope",
        "envelope_correction": "none; discrepancies retain per-request overhead",
        "request_shape": "single_user_text",
        "validation_status": "unvalidated_for_consumer_input_and_generated_output",
        "runtime_selection_allowed": False,
        "approved": False,
    }
    base.update(
        {
            "status": "reference_evaluation_complete_unvalidated" if complete else "incomplete",
            "evaluation_date": evaluation_date,
            "reference_kind": "provider_input_token_estimate",
            "profile": profile,
            "profile_hash": digest(profile),
            "training_metrics": training_metrics,
            "groups": groups,
            "results": rows,
            "missing": [
                "consumer_model_mapping",
                "generated_output_reference",
                "hidden_reasoning",
                "system_tool_multimodal_shapes",
                "modern_vs_historical_model_study",
            ],
        }
    )
    base["report_hash"] = digest(base)
    return base


def evaluate(client, model, cases, evaluation_date, interval=1.0, limit=None, sleep=time.sleep):
    validate_model(model)
    date.fromisoformat(evaluation_date)
    rows = []
    for case in cases[:limit]:
        if not case["text"]:
            # The API rejects an empty message (HTTP 400), which used to stop the run at the
            # corpus's first case. An empty text has no reference; it is recorded, not requested.
            value, reason, attempts, fatal = None, EMPTY_TEXT, 0, False
        else:
            if rows:
                sleep(interval)
            value, reason, attempts, fatal = request_count(client, model, case["text"], sleep)
        rows.append(
            {
                "fixture_id": case["id"],
                "group": case["group"],
                "split": case["split"],
                "request_shape": "single_user_text",
                "request_hash": digest(
                    {"model": model, "messages": [{"role": "user", "content": case["text"]}]}
                ),
                "content_utf8_bytes": len(case["text"].encode()),
                "candidate_counts": case["counts"],
                "reference_input_tokens": value,
                "reason": reason,
                "attempts": attempts,
            }
        )
        if fatal:
            break
    return report(model, cases, rows, evaluation_date)


def main(argv=None):
    parser = SafeArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--max-cases", type=int)
    args = parser.parse_args(argv)
    try:
        cases = load_corpus(args.corpus)
        result = plan(args.model, cases)
        if args.execute:
            if not args.output or args.output.exists():
                raise CalibrationError("new_output_path_required")
            if args.max_cases is not None and not 1 <= args.max_cases <= len(cases):
                raise CalibrationError("invalid_case_limit")
            key = os.environ.get("AIFT_ANTHROPIC_COUNTING_KEY", "")
            if not key or os.environ.get("ANTHROPIC_LOG"):
                raise CalibrationError("key_missing_or_debug_logging_enabled")
            with create_client(key) as client:
                result = evaluate(
                    client, args.model, cases, date.today().isoformat(), limit=args.max_cases
                )
            # Never overwrite an earlier generation/model's evidence or print response details.
            with args.output.open("x", encoding="utf-8") as output:
                json.dump(result, output, sort_keys=True, indent=2, ensure_ascii=False)
                output.write("\n")
            print(
                json.dumps({key: result[key] for key in ("status", "report_hash", "profile_hash")})
            )
            return 0 if result["status"] == "reference_evaluation_complete_unvalidated" else 2
        print(json.dumps(result, sort_keys=True, indent=2))
        return 0
    except CalibrationError as error:
        print(json.dumps({"status": "blocked", "reason": str(error)}))
        return 2
    except Exception:
        print(json.dumps({"status": "blocked", "reason": "calibration_failed"}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
