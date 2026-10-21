"""Select compatible numerical evidence without rewriting saved observations."""

import re

from footprint_contracts import OUTPUT_PARTS, compose_output_total

from .security import Problem


def _gemini_turn_label(history):
    """Mirror of geminiTurnLabel: a saved Gemini turn names the model that answered it, its
    live reply the chat's mode (5 Oct 2026)."""
    return history["site"] == "gemini"


def history_model_conflicts(history, attempt):
    """Mirror of historyModelConflicts: Claude history names only the chat's model (B5),
    a live model taken from the request was asked for, not the one that answered, and a
    Gemini reply's live label is the chat's mode."""
    return (
        history["site"] != "claude"
        and history["model_id"] is not None
        and attempt["model_id"] is not None
        and attempt["model_evidence"] == "response_field"
        and not _gemini_turn_label(history)
        and history["model_id"] != attempt["model_id"]
    )


def linked_reply_model(attempt, history=None):
    """Mirror of linkedReplyModel: the answering model, else the saved one, else the asked
    one; a Gemini turn's saved label wins over its live mode label."""
    if (
        history
        and history["site"] != "claude"
        and history["model_id"] is not None
        and (attempt["model_evidence"] != "response_field" or _gemini_turn_label(history))
    ):
        return history["model_id"]
    return attempt["model_id"] or (history["model_id"] if history else None)


def assert_linked_history(request, attempt, history):
    same_conversation = request["conversation_key"] == history["conversation_key"] or (
        request["site"] == "perplexity"
        and request["provider_request_key"] is not None
        and request["provider_request_key"] == history["provider_request_key"]
    )
    if (
        history["role"] != "response"
        or history["site"] != request["site"]
        or not same_conversation
        or attempt["provider_attempt_key"] is None
        or attempt["provider_attempt_key"] != history["provider_attempt_key"]
        or "request_identity_ambiguous" in request["coverage_reasons"]
        or "request_identity_ambiguous" in attempt["coverage_reasons"]
        or history_model_conflicts(history, attempt)
    ):
        raise Problem("estimation_input_unavailable", 409, True)


def _history_part(history, part):
    """Mirror of historyPart: every saved reply names its parts."""
    return history["parts"][part] if history.get("parts") else None


def select_part(live, history=None, part="answer_output"):
    """Mirror of selectPartMeasurement: complete saved text completes or grows a part."""
    saved = _history_part(history, part) if history else None
    if (
        not history
        or saved is None
        or saved["scope"] != "observed_text"
        or not history["text_complete"]
        or saved["value"] is None
        or saved["completeness"] != "complete_for_scope"
    ):
        return live
    if live["value"] is None:
        return saved
    if (
        live["scope"] == "observed_text"
        and live["evidence"] == saved["evidence"]
        and live["profile_id"] == saved["profile_id"]
        and int(saved["value"]) >= int(live["value"])
    ):
        return saved
    return live


def select_answer(attempt, history=None):
    return select_part(attempt["tokens"]["answer_output"], history, "answer_output")


def _selected_parts(attempt, history=None):
    return {part: select_part(attempt["tokens"][part], history, part) for part in OUTPUT_PARTS}


def _reported_output(attempt, history=None):
    """Mirror of reportedOutput: the live provider total first, then the linked saved one."""
    total = attempt["tokens"]["output_total"]
    if (
        total["evidence"] == "provider_reported"
        and total["scope"] == "provider_request"
        and total["value"] is not None
    ):
        return total
    saved = history["tokens"] if history else None
    if saved is not None and saved["evidence"] == "provider_reported" and saved["value"] is not None:
        return saved
    return None


def select_output(attempt, history=None):
    return _reported_output(attempt, history) or compose_output_total(_selected_parts(attempt, history))


def select_timing(attempt=None, history=None):
    saved_complete = bool(
        history
        and history["text_complete"]
        and "historical_timing_conflict" not in history["coverage_reasons"]
        and history["timing"]
        and history["timing"]["completeness"] == "complete_for_scope"
    )
    if saved_complete and history["timing"]["scope"] == "research_task":
        return history["timing"]
    if (
        attempt
        and attempt["state"] == "completed"
        and attempt["timing"]
        and (attempt["timing"]["completeness"] == "complete_for_scope")
    ):
        return attempt["timing"]
    if saved_complete:
        return history["timing"]
    return None


def project_attempt(attempt, history=None):
    parts = _selected_parts(attempt, history)
    return {
        **attempt,
        "model_id": linked_reply_model(attempt, history),
        "tokens": {
            **attempt["tokens"],
            **parts,
            "output_total": _reported_output(attempt, history) or compose_output_total(parts),
        },
        "execution_evidence": "content_observed"
        if history and history["text_complete"] and attempt["execution_evidence"] == "none"
        else attempt["execution_evidence"],
    }


def fuller_history_tokens(old, new):
    before, after = old["tokens"], new["tokens"]
    return (
        not old["text_complete"]
        and new["text_complete"]
        and before["value"] is not None
        and after["value"] is not None
        and before["completeness"] == "partial"
        and after["completeness"] == "complete_for_scope"
        and before["scope"] == after["scope"]
        and before["evidence"] == after["evidence"]
        and before["profile_id"] is not None
        and before["profile_id"] == after["profile_id"]
        and int(after["value"]) >= int(before["value"])
    )


def _unread_parts(message):
    """Mirror of unreadParts: the output parts a saved reply could not read."""
    parts = message.get("parts")
    if not parts:
        return None
    return ",".join(
        part
        for part in OUTPUT_PARTS
        if parts[part]["value"] is None and parts[part]["evidence"] != "not_applicable"
    )


def grown_history_tokens(old, new):
    """Mirror of grownHistoryTokens: a larger count of the same parts is the newer state of a reply."""
    before, after = old["tokens"], new["tokens"]
    return (
        old["role"] == "response"
        and before["value"] is not None
        and after["value"] is not None
        and before["scope"] == after["scope"]
        and before["evidence"] == after["evidence"]
        and before["profile_id"] == after["profile_id"]
        and int(after["value"]) > int(before["value"])
        and new["text_complete"]
        and (
            after["completeness"] == "complete_for_scope"
            or (
                after["completeness"] == "partial"
                and _unread_parts(old) is not None
                and _unread_parts(old) == _unread_parts(new)
                and all(
                    new["parts"][part]["value"] is None
                    or new["parts"][part]["completeness"] == "complete_for_scope"
                    for part in OUTPUT_PARTS
                )
            )
        )
    )


def _generation_facts(item):
    """Mirror of generationFacts: the facts a read gives about one generated item, as bits."""
    if "role" in item:
        return (
            (1 if item["model_id"] is not None else 0)
            | (2 if item["tokens"]["value"] is not None else 0)
            | (4 if item["tokens"]["completeness"] == "complete_for_scope" else 0)
        )
    if item["kind"] == "image":
        return (
            (1 if item["model_id"] is not None else 0)
            | (2 if item["width"] is not None and item["height"] is not None else 0)
            | (4 if item["outcome"] == "returned" else 0)
        )
    if item["kind"] == "video":
        return (
            (1 if item["model_id"] is not None else 0)
            | (2 if item["width"] is not None and item["height"] is not None else 0)
            | (4 if item["duration_seconds"] is not None else 0)
            | (8 if item["with_audio"] is not None else 0)
        )
    if item["kind"] == "speech":
        return 0 if item["length_basis"] == "characters" else 1
    return 0


def _generation_units(generation):
    groups = {}
    for item in generation["media"]:
        units = int(item["count"]) if item["kind"] == "image" else 1
        group = groups.setdefault(item["kind"], {})
        facts = _generation_facts(item)
        group[facts] = group.get(facts, 0) + units
    for component in generation["text_components"]:
        group = groups.setdefault("text:" + component["role"], {})
        facts = _generation_facts(component)
        group[facts] = group.get(facts, 0) + 1
    return groups


GENERATION_FACT_SETS = 12


def generation_covers(new, old):
    """Mirror of generationCovers: each saved item keeps a read item with at least its facts."""
    after = _generation_units(new)
    for key, saved in _generation_units(old).items():
        read = after.get(key, {})
        masks = list(saved)
        if len(masks) > GENERATION_FACT_SETS:
            return False
        for subset in range(1, 1 << len(masks)):
            chosen = [mask for index, mask in enumerate(masks) if subset & (1 << index)]
            demand = sum(saved[mask] for mask in chosen)
            supply = sum(
                units for facts, units in read.items() if any((facts & mask) == mask for mask in chosen)
            )
            if supply < demand:
                return False
    return True


SIDE_PARTS = ("tool_output", "reported_reasoning", "image_input_tokens")


def _same_measure(a, b):
    return a["evidence"] == b["evidence"] and a["scope"] == b["scope"] and a["profile_id"] == b["profile_id"]


def _keep_side_parts(old, new):
    """Mirror of keepSideParts: a reread never erases or lowers a known count outside the total."""
    if old["parts"] is None or new["parts"] is None:
        return new
    parts = new["parts"]
    for part in SIDE_PARTS:
        saved, read = old["parts"][part], parts[part]
        if saved["value"] is not None and (
            read["value"] is None or (_same_measure(saved, read) and int(saved["value"]) > int(read["value"]))
        ):
            parts = {**parts, part: saved}
    return new if parts is new["parts"] else {**new, "parts": parts}


def side_parts_conflict(old, new):
    """Mirror of sidePartsConflict: two known counts measured differently cannot both be right."""
    return any(
        old["parts"] is not None
        and new["parts"] is not None
        and old["parts"][part]["value"] is not None
        and new["parts"][part]["value"] is not None
        and not _same_measure(old["parts"][part], new["parts"][part])
        for part in SIDE_PARTS
    )


def claude_refines_model(old, new):
    """
    Mirror of claudeRefinesModel: a Claude reread may replace a saved placeholder
    (claude-unlisted by a family placeholder, a family placeholder by a listed model of
    that family) but never names a later model for an older reply.
    """
    if not old or not new or old == new:
        return False
    if old == "claude-unlisted":
        return re.fullmatch(r"claude-[a-z]+-unlisted", new) is not None
    family = re.fullmatch(r"claude-([a-z]+)-unlisted", old)
    return family is not None and new.startswith(f"claude-{family.group(1)}-") and not new.endswith("-unlisted")


def merge_history_evidence(old, new):
    if any(old[key] != new[key] for key in ("message_key", "conversation_key", "site", "role")):
        return new
    stable = {
        "model_id": (
            new["model_id"]
            if claude_refines_model(old["model_id"], new["model_id"])
            else old["model_id"]
            if old["model_id"] is not None
            else new["model_id"]
        )
        if old["site"] == "claude"
        else (new["model_id"] if new["model_id"] is not None else old["model_id"]),
        "company_dedup_key": old["company_dedup_key"]
        if old["company_dedup_key"] is not None
        else new["company_dedup_key"],
    }
    if grown_history_tokens(old, new):
        return _keep_side_parts(
            old,
            {
                **new,
                **stable,
                "generation": new["generation"]
                if generation_covers(new["generation"], old["generation"])
                else old["generation"],
            },
        )
    if grown_history_tokens(new, old):
        return {
            **old,
            "observed_at": new["observed_at"],
            "generation": new["generation"]
            if generation_covers(new["generation"], old["generation"])
            else old["generation"],
        }
    retained = {**new, **stable, "timing": new["timing"] if new["timing"] is not None else old["timing"]}
    old_complete = old["timing"] is not None and old["timing"]["completeness"] == "complete_for_scope"
    new_complete = new["timing"] is not None and new["timing"]["completeness"] == "complete_for_scope"
    if (
        "historical_timing_conflict" in old["coverage_reasons"]
        or "historical_timing_conflict" in new["coverage_reasons"]
        or (old_complete and new_complete and old["timing"] != new["timing"])
    ):
        retained["timing"] = None
        retained["coverage_reasons"] = list(
            dict.fromkeys([*new["coverage_reasons"], "historical_timing_conflict"])
        )
    elif old["timing"] is not None and not new_complete:
        retained["timing"] = old["timing"]
    # A reread that could not count keeps the saved counts, as mergeHistoryEvidence does.
    if old["tokens"]["value"] is not None and new["tokens"]["value"] is None:
        retained.update(tokens=old["tokens"], parts=old["parts"], inline_file_text=old["inline_file_text"])
    if fuller_history_tokens(new, old):
        retained.update(tokens=old["tokens"], parts=old["parts"], text_complete=old["text_complete"])
    if not generation_covers(retained["generation"], old["generation"]):
        retained["generation"] = old["generation"]
    return _keep_side_parts(old, retained)
