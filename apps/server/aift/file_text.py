"""Non-additive request-scoped extraction projections. Never normalize stored observations."""

from decimal import Decimal

from footprint_contracts import claude_measurement

from .security import canonical

FILE_COVERAGE_FIELDS = ("observed_request_count", "unknown_request_count")


def components(payload):
    return payload["documents"]["extracted_text"]


def coverage(payload):
    known = components(payload) is not None
    return {
        "observed_request_count": str(int(known)),
        "unknown_request_count": str(int(not known)),
        "scope": "extracted_file_text",
        "additive": False,
    }


def projections(payload, factor=None):
    yield from project_components(components(payload), factor)


def project_components(items, factor=None):
    """factor: the Claude token factor when the request or message is Claude's (claude_factor_for)."""
    for component in items or []:
        measured = claude_measurement(component["tokens"], factor)
        known = measured["value"] is not None
        group = {
            "origin": component["origin"],
            "extraction_profile_id": component["extraction_profile_id"],
            "evidence": measured["evidence"],
            "profile_id": measured["profile_id"],
        }
        yield (
            canonical(group),
            {
                "quantity": "extracted_file_text",
                "scope": "extracted_file_text",
                "unit": "tokens",
                "additive": False,
                "measurement_group": group,
                "value": Decimal(measured["value"] or "0"),
                "applicable_count": 1,
                "contributing_component_count": int(known),
                "unknown_count": int(not known),
                "partial_count": int(measured["completeness"] == "partial"),
                "unvalidated_count": int(known),
                "reason_counts": {measured["reason"]: 1} if measured["reason"] else {},
                "missing_counts": {reason: 1 for reason in component["missing"]},
            },
        )


def count_fields(series):
    return (
        "applicable_count",
        "unknown_count",
        "partial_count",
        "unvalidated_count",
        "contributing_component_count"
        if "contributing_component_count" in series
        else "contributing_attempt_count",
    )


def request_disclosure(payload):
    groups = {key: 1 for key, _ in projections(payload)}
    return {"component_request_count": int(bool(groups)), "group_request_counts": groups}
