"""Strict numerical telemetry boundary. Never include validation inputs in logs."""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

_ROOT = Path(__file__).resolve().parents[1] / "schema"
SUPPORTED_SCHEMA_VERSIONS = ("3.0.0",)
_VALIDATORS = {
    version: {
        name: Draft202012Validator(
            json.loads((_ROOT / f"{name}-{version}.schema.json").read_text()), format_checker=FormatChecker()
        )
        for name in ("observation", "usage-batch")
    }
    for version in SUPPORTED_SCHEMA_VERSIONS
}
MAX_COUNTER = 9223372036854775807
OUTPUT_PARTS = ("answer_output", "visible_thinking", "tool_input", "intermediate_output")
_TIMING_SCOPES = {
    "browser_request": ("request",),
    "chatgpt_history": ("provider_message", "research_task"),
    "claude_history": ("content_blocks", "research_task"),
    "perplexity_history": ("workflow",),
    "gemini_history": ("research_task",),
    "cowork_history": ("provider_message",),
    "notebooklm_history": ("provider_message",),
}


class ContractError(ValueError):
    def __init__(self, code="payload_rejected"):
        super().__init__(code)
        self.code = code


def canonical_json(value):
    def checked(v, depth=0):
        if depth > 16:
            raise ContractError()
        if v is None or isinstance(v, (str, bool)):
            return
        if type(v) is int and abs(v) <= 9007199254740991:
            return
        if isinstance(v, list):
            for item in v:
                checked(item, depth + 1)
            return
        if isinstance(v, dict) and all(type(k) is str for k in v):
            for item in v.values():
                checked(item, depth + 1)
            return
        raise ContractError()

    checked(value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def payload_hash(value):
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def unknown_measurement(reason="provider_usage_unavailable"):
    return {
        "value": None,
        "evidence": "unknown",
        "scope": "observed_text",
        "completeness": "unknown",
        "profile_id": None,
        "reason": reason,
    }


def not_applicable_measurement():
    return {
        "value": None,
        "evidence": "not_applicable",
        "scope": "observed_text",
        "completeness": "unknown",
        "profile_id": None,
        "reason": "not_applicable",
    }


def history_response_parts(answer, **other):
    """Mirror of historyResponseParts: parts not given do not apply."""
    parts = {"answer_output": answer}
    for name in ("visible_thinking", "tool_input", "intermediate_output", "reported_reasoning", "tool_output"):
        parts[name] = other.get(name, not_applicable_measurement())
    parts["image_input_tokens"] = not_applicable_measurement()
    return parts


def history_token_parts(message):
    """Mirror of historyTokenParts: a message's own count, its role's input-side part, then
    one row per output of another model in a reply (D3)."""
    part = "image_input_tokens" if message["role"] == "prompt" else "tool_output"
    side = message["parts"][part] if message.get("parts") is not None else unknown_measurement()
    rows = [("total", message["tokens"])] + ([] if side["evidence"] == "not_applicable" else [(part, side)])
    return rows + [("other_models", component["tokens"]) for component in message["generation"]["text_components"]]


def compose_output_total(parts):
    """Mirror of composeOutputTotal: a missing part is never read as zero."""
    values = [parts[part] for part in OUTPUT_PARTS]
    known = [m for m in values if m["value"] is not None]
    missing = [m for m in values if m["value"] is None and m["evidence"] != "not_applicable"]
    if not known:
        reason = missing[0]["reason"] if missing else None
        if reason is None:
            reason = parts["answer_output"]["reason"]
        return unknown_measurement(reason if reason is not None else "estimate_unavailable")
    profiles = {m["profile_id"] for m in known}
    evidence = {m["evidence"] for m in known}
    incomplete = [m for m in known if m["completeness"] != "complete_for_scope"]
    partial = bool(missing) or bool(incomplete) or len(profiles) > 1 or len(evidence) > 1
    if partial:
        reason = missing[0]["reason"] if missing else None
        if reason is None and incomplete:
            reason = incomplete[0]["reason"]
        if reason is None:
            reason = "partial_capture"
    else:
        reason = known[0]["reason"]
    return {
        "value": str(sum(int(m["value"]) for m in known)),
        "evidence": next(iter(evidence)) if len(evidence) == 1 else "heuristic_estimate",
        "scope": "observed_text",
        "completeness": "partial" if partial else "complete_for_scope",
        "profile_id": next(iter(profiles)) if len(profiles) == 1 else None,
        "reason": reason,
    }


def claude_text(site, model_id):
    """Mirror of claudeText: claude.ai and Cowork always, Perplexity by the registry id."""
    if site == "claude":
        return True
    return (
        site == "perplexity"
        and model_id is not None
        and (model_id.startswith("perplexity-claude-") or model_id == "perplexity-unlisted-anthropic")
    )


def claude_factor_for(site, model_id, factor):
    """Mirror of claudeFactorFor: the media policy's claude_token_factor, or None."""
    return factor if factor and claude_text(site, model_id) else None


def claude_token_count(value, factor):
    """Mirror of claudeTokenCount: factor times count, rounded half up in integers."""
    whole, _, fraction = factor["factor"].partition(".")
    numerator = int(whole + fraction)
    denominator = 10 ** len(fraction)
    return str((2 * int(value) * numerator + denominator) // (2 * denominator))


def claude_measurement(measurement, factor):
    """Mirror of claudeMeasurement: only a known count of the factor's tokenizer profile changes."""
    if (
        not factor
        or measurement["value"] is None
        or measurement["evidence"] != "heuristic_estimate"
        or measurement["profile_id"] != factor["tokenizer_profile_id"]
    ):
        return measurement
    return {**measurement, "value": claude_token_count(measurement["value"], factor)}


def claude_token_fields(tokens, factor):
    """Mirror of claudeTokenFields: each part corrected, the total their sum unless reported."""
    if not factor:
        return tokens
    corrected = {field: claude_measurement(measured, factor) for field, measured in tokens.items()}
    if tokens["output_total"]["evidence"] != "provider_reported":
        corrected["output_total"] = compose_output_total(corrected)
    return corrected


def claude_text_components(site, components, factor):
    """Mirror of claudeTextComponents."""
    result = []
    for component in components:
        own = claude_factor_for(site, component["model_id"], factor)
        result.append({**component, "tokens": claude_measurement(component["tokens"], own)} if own else component)
    return result


def claude_history_message(record, factor):
    """Mirror of claudeHistoryMessage: parts one by one, a reply's total as their sum."""
    if not factor:
        return record
    own = claude_factor_for(record["site"], record["model_id"], factor)
    parts = record.get("parts")
    if own and parts is not None:
        parts = {part: claude_measurement(measured, own) for part, measured in parts.items()}
    tokens = record["tokens"]
    if own and tokens["evidence"] != "provider_reported":
        tokens = (
            compose_output_total(parts)
            if record["role"] == "response" and parts is not None
            else claude_measurement(tokens, own)
        )
    files = record.get("inline_file_text")
    if own and files is not None:
        files = [{**component, "tokens": claude_measurement(component["tokens"], own)} for component in files]
    return {
        **record,
        "tokens": tokens,
        "parts": parts,
        "inline_file_text": files,
        "generation": {
            **record["generation"],
            "text_components": claude_text_components(
                record["site"], record["generation"]["text_components"], factor
            ),
        },
    }


def counts_as_request(payload):
    """Read aloud makes speech from a reply already counted and NotebookLM writes its
    notebook guides by itself (W9): their energy counts, but they are not requests, so
    request counts stay comparable with the prompts history shows."""
    return payload.get("action") not in ("read_aloud", "notebook_guide")


def regenerated_history_replies(records):
    """Mirror of regeneratedHistoryReplies: the message keys of saved claude.ai chat replies
    that regenerated an earlier reply to the same prompt. Each was its own request
    (retry_completion), so an unmatched one adds one request to a history summary. The
    earliest reply (by occurred_at, undated last, then message_key) is the prompt's send."""
    groups = {}
    for record in records:
        if (
            record["role"] != "response"
            or record["site"] != "claude"
            or record["provider_attempt_key"] is None
            or record["prompt_key"] is None
            or record["parent_key"] != record["prompt_key"]
        ):
            continue
        group = groups.setdefault((record["conversation_key"], record["prompt_key"]), {})
        group[record["message_key"]] = record["occurred_at"]
    def order(item):
        key, occurred_at = item
        if occurred_at is None:
            return (True, "", key)
        # As compareHistoricalInstants: the fraction (3 to 6 digits) padded to microseconds.
        whole, fraction = occurred_at[:-1].split(".")
        return (False, whole + "." + fraction.ljust(6, "0"), key)

    regenerated = set()
    for replies in groups.values():
        ordered = sorted(replies.items(), key=order)
        regenerated.update(key for key, _ in ordered[1:])
    return regenerated


def history_timing_sources(site):
    return ("claude_history", "cowork_history") if site == "claude" else (site + "_history",)


def _generation(value):
    for item in value["media"]:
        # Measured audio has a length in seconds; the reading-rate rule has only characters.
        if item["kind"] == "speech" and (
            (item["characters"] is None or item["characters"] == "0" or item["seconds"] is not None)
            if item["length_basis"] == "characters"
            else (item["seconds"] is None or item["characters"] is not None)
        ):
            raise ContractError()
        # A stopped or failed job that visibly started counts as exactly one image.
        if item["kind"] == "image" and (
            item["count"] == "0" or (item["outcome"] == "started_not_returned" and item["count"] != "1")
        ):
            raise ContractError()
        for key in ("seconds", "duration_seconds"):
            if item.get(key) is not None and not 0 < Decimal(item[key]) <= 86400:
                raise ContractError()
    for component in value["text_components"]:
        validate_timing(component["timing"])


def _bounds(value, depth=0):
    if depth > 16:
        raise ContractError()
    if isinstance(value, dict):
        for key, child in value.items():
            if key in ("coverage_reasons", "features", "types") and len(child) != len(set(child)):
                raise ContractError()
            if (
                key
                in (
                    "value",
                    "count",
                    "upload_count",
                    "requested_count",
                    "returned_count",
                    "observed_search_operations",
                    "characters",
                )
                and child is not None
                and int(child) > MAX_COUNTER
            ):
                raise ContractError()
            if key.endswith("_at"):
                if child is not None:
                    try:
                        datetime.strptime(child, "%Y-%m-%dT%H:%M:%S.%fZ")
                    except ValueError:
                        raise ContractError() from None
            _bounds(child, depth + 1)
        if "evidence" in value and "completeness" in value:
            if value["value"] is None and value["reason"] is None:
                raise ContractError()
            if value["evidence"] in ("unknown", "not_applicable") and (
                value["value"] is not None or value["reason"] is None
            ):
                raise ContractError()
            if value["value"] is not None and value["evidence"] == "calibrated_estimate":
                raise ContractError()
    elif isinstance(value, list):
        for child in value:
            _bounds(child, depth + 1)


def validate_observation(value):
    version = value.get("schema_version") if isinstance(value, dict) else None
    if (
        type(version) is not str
        or version not in _VALIDATORS
        or not _VALIDATORS[version]["observation"].is_valid(value)
    ):
        raise ContractError()
    _bounds(value)
    if "historical_timing_conflict" in value["coverage_reasons"]:
        raise ContractError()
    # A live record is a live request by definition (W9 review).
    if "no_live_request" in value["coverage_reasons"]:
        raise ContractError()
    # The company key travels beside the record and is never stored with it (W11).
    if value["company_dedup_key"] is not None:
        raise ContractError()
    start = value["dispatched_at"] if value["kind"] == "request" else value["started_at"]
    if value["ended_at"] is not None and value["ended_at"] < start:
        raise ContractError()
    media = value["media"]
    if sum(len(v) for k, v in media.items() if k != "coverage_reasons") > 100:
        raise ContractError()
    operations = media.get("image_operations", media.get("requested_operations", []))
    if len({o["operation_key"] for o in operations}) != len(operations):
        raise ContractError()
    if value["kind"] == "attempt":
        timing = value["timing"]
        validate_timing(timing)
        _generation(value["generation"])
        total = value["tokens"]["output_total"]
        if canonical_json(total) != canonical_json(compose_output_total(value["tokens"])) and (
            total["evidence"] != "provider_reported"
            or total["scope"] != "provider_request"
            or total["value"] is None
        ):
            raise ContractError()
        if timing is not None and (
            timing["source"] != "browser_request"
            or (timing["completeness"] == "complete_for_scope" and value["state"] != "completed")
        ):
            raise ContractError()
        for group in media["generated_images"]:
            if not any(o["operation_key"] == group["operation_key"] for o in operations):
                raise ContractError()
        for op in operations:
            count = sum(
                int(g["count"])
                for g in media["generated_images"]
                if g["operation_key"] == op["operation_key"]
            )
            if op["returned_count"] is not None and count > int(op["returned_count"]):
                raise ContractError()
    if value["kind"] == "request":
        # Read aloud is ChatGPT speech made from a reply already shown, audio only (G1). It is
        # left out of request counts, so no other request may take its shape: it uploads no
        # documents or images, asks for none and runs no searches.
        documents = value["documents"]
        if value["action"] == "read_aloud" and (
            value["site"] != "chatgpt"
            or value["features"] != ["audio"]
            or documents["upload_count"] not in (None, "0")
            or documents["types"]
            or documents["extracted_text"] is not None
            or documents["processing"] not in ("none", "unknown")
            or media["input_images"]
            or media["requested_operations"]
            or value["observed_search_operations"] not in (None, "0")
        ):
            raise ContractError()
        # A notebook guide is text NotebookLM writes from the notebook's sources, which are
        # hidden input: it has no prompt, uploads and searches nothing (W9).
        if value["action"] == "notebook_guide" and (
            value["site"] != "notebooklm"
            or value["features"] != ["text"]
            or documents["upload_count"] not in (None, "0")
            or documents["types"]
            or documents["extracted_text"] is not None
            or documents["processing"] not in ("none", "unknown")
            or media["input_images"]
            or media["requested_operations"]
            or value["observed_search_operations"] not in (None, "0")
        ):
            raise ContractError()
        components = value["documents"]["extracted_text"] or []
        if len({c["component_id"] for c in components}) != len(components):
            raise ContractError()
        if len(components) + len(media["input_images"]) + len(media["requested_operations"]) > 100:
            raise ContractError()
        uploads = value["documents"]["upload_count"]
        if uploads is not None and sum(c["origin"] == "new_upload" for c in components) > int(uploads):
            raise ContractError()
        for component in components:
            if component["page_count"] is not None and type(component["page_count"]) is not int:
                raise ContractError()
            missing = component["missing"]
            if len(missing) != len(set(missing)) or "provider_processing" not in missing:
                raise ContractError()
            measurement = component["tokens"]
            if measurement["value"] is None:
                if (
                    measurement["reason"] is None
                    or measurement["evidence"] != "unknown"
                    or measurement["completeness"] != "unknown"
                ):
                    raise ContractError()
            elif (
                measurement["evidence"] != "heuristic_estimate"
                or measurement["profile_id"] is None
                or measurement["completeness"] == "unknown"
                or measurement["reason"] is None
            ):
                raise ContractError()
    return value


def validate_batch(value):
    version = value.get("schema_version") if isinstance(value, dict) else None
    if (
        type(version) is not str
        or version not in _VALIDATORS
        or len(canonical_json(value).encode("utf-8")) > 524288
        or not _VALIDATORS[version]["usage-batch"].is_valid(value)
    ):
        raise ContractError()
    _bounds(value)
    for record in value["records"]:
        validate_observation(record)
    # Company keys travel beside the records, one per record of the batch at most (W11).
    entries = value.get("company_dedup_keys")
    if entries is not None:
        records = {
            (r["kind"], r["request_id"] if r["kind"] == "request" else r["attempt_id"]) for r in value["records"]
        }
        named = [(entry["kind"], entry["record_id"]) for entry in entries]
        if len(set(named)) != len(named) or not set(named) <= records:
            raise ContractError()
    return value


_HISTORY_VALIDATOR = Draft202012Validator(json.loads((_ROOT / "history-page-3.0.0.schema.json").read_text()))


def validate_history_page(value):
    if not _HISTORY_VALIDATOR.is_valid(value) or len(canonical_json(value).encode()) > 262144:
        raise ContractError()
    _bounds(value)
    messages = value["messages"]
    if len({m["message_key"] for m in messages}) != len(messages):
        raise ContractError()
    # Company keys travel beside the messages, one per message of this page at most, and
    # never inside a message (W11).
    entries = value.get("company_dedup_keys")
    if entries is not None:
        named = [entry["message_key"] for entry in entries]
        if len(set(named)) != len(named) or not set(named) <= {m["message_key"] for m in messages}:
            raise ContractError()
    if any(m["company_dedup_key"] is not None for m in messages):
        raise ContractError()
    if value["first_request_verified"] and value["root_message_key"] is None:
        raise ContractError()
    if value["branch_message_keys"] is not None and len(set(value["branch_message_keys"])) != len(
        value["branch_message_keys"]
    ):
        raise ContractError()
    for message in messages:
        tokens = message["tokens"]
        timing = message["timing"]
        validate_timing(timing)
        timing_conflict = "historical_timing_conflict" in message["coverage_reasons"]
        if timing_conflict and (message["role"] != "response" or timing is not None):
            raise ContractError()
        # Only NotebookLM's saved Studio rows lack a live request; its saved chat turns wait
        # for a live match. Elsewhere the reason would hide a possible double count (W9 review).
        if "no_live_request" in message["coverage_reasons"] and message["site"] != "notebooklm":
            raise ContractError()
        if len(message["coverage_reasons"]) > 32 and not timing_conflict:
            raise ContractError()
        if timing is not None and (
            message["role"] != "response"
            or timing["source"] not in history_timing_sources(message["site"])
            or (timing["completeness"] == "complete_for_scope" and not message["text_complete"])
        ):
            raise ContractError()
        if (
            message["conversation_key"] != value["conversation_key"]
            or message["site"] != value["site"]
            or (message["occurred_at"] is None) != (message["date_basis"] == "unknown")
        ):
            raise ContractError()
        if message["role"] == "prompt" and message["provider_attempt_key"] is not None:
            raise ContractError()
        if tokens["evidence"] == "provider_reported":
            if message["role"] != "response" or tokens["scope"] != "provider_request" or tokens["value"] is None:
                raise ContractError()
        else:
            if tokens["scope"] != "observed_text" or tokens["evidence"] not in ("heuristic_estimate", "unknown"):
                raise ContractError()
            if tokens["value"] is None:
                if tokens["evidence"] != "unknown":
                    raise ContractError()
            elif tokens["evidence"] != "heuristic_estimate" or tokens["profile_id"] is None:
                raise ContractError()
        parts = message["parts"]
        # A reply's total is its parts' sum, so every reply names its parts.
        if parts is None and message["role"] == "response":
            raise ContractError()
        if parts is not None:
            if message["role"] == "prompt":
                if any(
                    parts[name]["evidence"] != "not_applicable"
                    for name in (*OUTPUT_PARTS, "reported_reasoning", "tool_output")
                ):
                    raise ContractError()
            elif parts["image_input_tokens"]["evidence"] != "not_applicable" or (
                tokens["evidence"] != "provider_reported"
                and canonical_json(tokens) != canonical_json(compose_output_total(parts))
            ):
                raise ContractError()
        generation = message["generation"]
        _generation(generation)
        if message["role"] == "prompt" and (generation["text_components"] or generation["media"]):
            raise ContractError()
        for component in message["inline_file_text"] or []:
            measured = component["tokens"]
            if "provider_processing" not in component["missing"] or len(set(component["missing"])) != len(
                component["missing"]
            ):
                raise ContractError()
            if measured["value"] is None:
                if (
                    measured["evidence"] != "unknown"
                    or measured["completeness"] != "unknown"
                    or measured["reason"] is None
                ):
                    raise ContractError()
            elif (
                measured["evidence"] != "heuristic_estimate"
                or measured["profile_id"] is None
                or measured["completeness"] == "unknown"
                or measured["reason"] is None
            ):
                raise ContractError()
    return value


def validate_timing(value):
    if value is None:
        return
    try:
        duration = Decimal(value["duration_seconds"])
        number = float(duration)
        if not duration.is_finite() or not math.isfinite(number) or number <= 0 or not 0 < duration <= 86400:
            raise ContractError()
        if value["scope"] not in _TIMING_SCOPES.get(value["source"], ()):
            raise ContractError()
    except (InvalidOperation, ValueError, KeyError, TypeError, OverflowError):
        raise ContractError() from None
