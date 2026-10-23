"""One ownership-scoped resolver for historical suppression and live evidence enrichment."""

from contextlib import contextmanager

from footprint_contracts import ContractError, payload_hash, validate_observation
from sqlalchemy import select

from .db import DeletionScope, DeletionTombstone, HistoryObservation, Observation, get
from .engine_history import PassedChecks
from .security import Problem
from .timing_evidence import assert_linked_history

_MEMO = "history_matching_memo"
_validate_observation = PassedChecks(lambda value: validate_observation(value))


@contextmanager
def read_memo(session):
    """
    Remembers matching answers for the rest of one read-only request on this session. A summary
    with its day, tool and model splits asks the same questions about the same rows dozens of
    times, and each answer costs several queries and schema checks. Only a request that writes
    nothing to these tables may open it: an answer must not outlive the data it was read from.
    """
    if _MEMO in session.info:
        yield
        return
    session.info[_MEMO] = {}
    try:
        yield
    finally:
        session.info.pop(_MEMO, None)


def remembered(session, key, compute):
    memo = session.info.get(_MEMO)
    if memo is None:
        return compute()
    if key not in memo:
        memo[key] = compute()
    return memo[key]


def remembering(session):
    return _MEMO in session.info


def memo_of(session):
    """The open read memo's answers, or None outside one."""
    return session.info.get(_MEMO)


def seed_visible_rows(session, rows):
    """
    Records what _history_rows would return for each row's own message key. The rows were read
    in this request with HistoricalUsage.visible and the message key is the primary key, so the
    answer is the row itself when it is current and its stored hash holds, and nothing otherwise.
    """
    memo = session.info.get(_MEMO)
    if memo is None:
        return
    for row in rows:
        key = ("rows", row.tenant, row.owner, (("message_key", row.message_key),))
        if key not in memo:
            memo[key] = [row] if row.status == "current" and _hash_holds(session, row) else []


def _hash_holds(session, row):
    from .historical_usage import numeric_payload_hash

    return remembered(
        session,
        ("hash", row.tenant, row.owner, row.message_key),
        lambda: row.payload_hash == numeric_payload_hash(row.payload),
    )


def _history_rows(session, tenant, owner, **filters):
    if _MEMO in session.info and set(filters) == {"site", "provider_attempt_key"}:
        # One read of the person's replies on the tool answers every reply's search for its
        # attempt key; a query per reply scans all their saved messages each time. History pages
        # store attempt keys as strings or null, so a string comparison here matches the SQL one.
        by_key = remembered(
            session,
            ("attempt keys", tenant, owner, filters["site"]),
            lambda: _by_attempt_key(_history_rows(session, tenant, owner, site=filters["site"])),
        )
        return by_key.get(filters["provider_attempt_key"], [])
    return remembered(
        session,
        _rows_key(tenant, owner, filters),
        lambda: _read_history_rows(session, tenant, owner, filters),
    )


def _rows_key(tenant, owner, filters):
    return ("rows", tenant, owner, tuple(sorted(filters.items())))


def _by_attempt_key(rows):
    index = {}
    for row in rows:
        value = row.payload.get("provider_attempt_key")
        if isinstance(value, str):
            index.setdefault(value, []).append(row)
    return index


def _read_history_rows(session, tenant, owner, filters):
    from .historical_usage import HistoricalUsage, load_rows

    conditions = [
        HistoryObservation.tenant == tenant,
        HistoryObservation.owner == owner,
        HistoryObservation.status == "current",
        HistoricalUsage(None).visible(None),
    ]
    for key, value in filters.items():
        column = (
            HistoryObservation.payload[key].as_string()
            if key in {"provider_attempt_key", "provider_request_key", "prompt_key"}
            else getattr(HistoryObservation, key)
        )
        conditions.append(column == value)
    # Callers count or search these rows, so the order of the rows does not matter.
    return [row for row in load_rows(session, conditions) if _hash_holds(session, row)]


def _live_valid(session, row, request=None):
    if row is None:
        return False
    return remembered(
        session,
        ("live", row.tenant, row.owner, row.kind, row.id, request.id if request else None),
        lambda: _check_live(session, row, request),
    )


def _check_live(session, row, request):
    if (
        row is None
        or row.status != "current"
        or "request_identity_ambiguous" in row.payload["coverage_reasons"]
    ):
        return False
    try:
        _validate_observation(row.payload)
    except (ContractError, ValueError, TypeError):
        return False
    if payload_hash(row.payload) != row.payload_hash:
        return False
    if _tombstoned(session, row.tenant, row.owner, row.kind, row.id):
        return False
    when = request.occurred_at if request else row.occurred_at
    cutoff = retention_row(session, row.tenant)
    if cutoff and cutoff.data.get("cutoff") and when < cutoff.data["cutoff"]:
        return False
    for marker in _markers(session, row.tenant):
        if marker.deletion_user_id is not None and marker.deletion_user_id != row.owner:
            continue
        # Only deleting a person covers all time; a company erasure keeps its frozen range.
        if marker.scope == "user" or marker.range_start <= when < marker.range_end:
            return False
    return True


def _tombstoned(session, tenant, owner, kind, record_id):
    return remembered(
        session,
        ("tombstone", tenant, owner, kind, record_id),
        lambda: session.get(DeletionTombstone, (tenant, owner, kind, record_id)) is not None,
    )


def retention_row(session, tenant):
    """The organization's stored retention cutoff row. Inside a read memo it is read once: the
    summary and each of its splits ask for it, and the memo keeps the row alive."""
    return remembered(session, ("retention row", tenant), lambda: get(session, "retention", tenant, tenant))


def _markers(session, tenant):
    # Every erasure marker of the organization: a person's own and those for everyone are kept
    # apart by the caller, as the query per check did with its owner condition.
    return remembered(
        session,
        ("markers", tenant),
        lambda: list(session.scalars(select(DeletionScope).where(DeletionScope.tenant == tenant))),
    )


def _record(session, tenant, owner, kind, record_id):
    return remembered(
        session,
        ("record", tenant, owner, kind, record_id),
        lambda: session.get(Observation, (tenant, owner, kind, record_id)),
    )


def _attempts(session, tenant, owner, attempt_key):
    return remembered(
        session,
        ("attempts", tenant, owner, attempt_key),
        lambda: list(
            session.scalars(
                select(Observation).where(
                    Observation.tenant == tenant,
                    Observation.owner == owner,
                    Observation.kind == "attempt",
                    Observation.stable_key == attempt_key,
                )
            )
        ),
    )


def _requests(session, tenant, owner, site, request_key):
    return remembered(
        session,
        ("requests", tenant, owner, site, request_key),
        lambda: list(
            session.scalars(
                select(Observation).where(
                    Observation.tenant == tenant,
                    Observation.owner == owner,
                    Observation.kind == "request",
                    Observation.site == site,
                    Observation.stable_key == request_key,
                )
            )
        ),
    )


def _response_matches(session, row):
    return remembered(
        session,
        ("matches", row.tenant, row.owner, row.message_key),
        lambda: _find_response_matches(session, row),
    )


def _find_response_matches(session, row):
    m = row.payload
    if not m["provider_attempt_key"]:
        return []
    matches = []
    for attempt in _attempts(session, row.tenant, row.owner, m["provider_attempt_key"]):
        request = _record(session, row.tenant, row.owner, "request", attempt.parent)
        if not _live_valid(session, request) or not _live_valid(session, attempt, request):
            continue
        try:
            assert_linked_history(request.payload, attempt.payload, m)
        except Problem:
            continue
        peers = [
            h
            for h in _history_rows(
                session, row.tenant, row.owner, site=m["site"], provider_attempt_key=m["provider_attempt_key"]
            )
            if h.role == "response"
            and h.payload["provider_attempt_key"] == m["provider_attempt_key"]
            and (
                h.conversation == request.conversation
                or (
                    m["site"] == "perplexity"
                    and request.stable_key is not None
                    and h.payload["provider_request_key"] == request.stable_key
                )
            )
        ]
        if len(peers) == 1:
            matches.append((request, attempt))
    return matches


def resolve_history_live(session, row):
    return remembered(
        session,
        ("resolve", row.tenant, row.owner, row.message_key),
        lambda: _resolve(session, row),
    )


def _resolve(session, row):
    if row.status != "current" or row not in _history_rows(
        session, row.tenant, row.owner, message_key=row.message_key
    ):
        return None
    if row.role == "response":
        matches = _response_matches(session, row)
        return matches[0] if len(matches) == 1 else None
    m = row.payload
    if m["provider_request_key"]:
        matches = [
            r
            for r in _requests(session, row.tenant, row.owner, row.site, m["provider_request_key"])
            if _live_valid(session, r) and (r.conversation == row.conversation or r.site == "perplexity")
        ]
        return (matches[0], None) if len(matches) == 1 else None
    requests = {}
    for response in _chat_replies(session, row.tenant, row.owner, row.site, row.conversation).get(
        row.message_key, ()
    ):
        matches = _response_matches(session, response)
        if len(matches) == 1 and matches[0][0].payload["action"] in ("send", "edit_and_send"):
            requests[matches[0][0].id] = matches[0]
    return next(iter(requests.values())) if len(requests) == 1 else None


def _chat_replies(session, tenant, owner, site, conversation):
    """
    The saved replies of a chat per prompt key, in the order of the chat's rows. Without it every
    prompt read all messages of its chat, so a summary's work grew with the square of a chat's
    length; in a read memo the chat is indexed once.
    """

    def index():
        found = {}
        for response in _history_rows(session, tenant, owner, site=site, conversation=conversation):
            if response.role == "response":
                found.setdefault(response.payload["prompt_key"], []).append(response)
        return found

    return remembered(session, ("replies by prompt", tenant, owner, site, conversation), index)


def prefetch(session, rows):
    """
    Reads together what resolve_history_live would read for each of rows, one query per kind of
    record instead of several per row; a 30-day summary resolves hundreds of saved messages. Each
    answer is the set the per-row query returns (the same conditions, with IN lists in place of
    one value) and is remembered under that query's key, so the per-row code runs unchanged and
    finds it. A question not prefetched here is still asked on its own. Outside a read memo this
    does nothing: nothing would keep the answers.
    """
    memo = session.info.get(_MEMO)
    if memo is None:
        return
    pending = [
        r for r in rows if r.status == "current" and ("resolve", r.tenant, r.owner, r.message_key) not in memo
    ]
    # A saved prompt without a request key is matched through the replies of its chat.
    chats = {}
    for r in pending:
        if r.role == "prompt" and not r.payload["provider_request_key"]:
            key = _rows_key(r.tenant, r.owner, {"site": r.site, "conversation": r.conversation})
            if key not in memo:
                chats[key] = (r.tenant, r.owner, r.site, r.conversation)
    replies = [r for r in pending if r.role == "response"]
    for key, found in _chat_rows(session, chats).items():
        memo[key] = found
        replies.extend(h for h in found if h.role == "response")

    wanted = {}
    for h in replies:
        attempt_key = h.payload["provider_attempt_key"]
        if attempt_key and ("matches", h.tenant, h.owner, h.message_key) not in memo:
            wanted.setdefault(h.tenant, set()).add((h.owner, attempt_key))
    attempts = _seed(session, memo, "attempts", wanted, Observation.stable_key, kind="attempt")

    wanted = {}
    for found in attempts:
        for attempt in found:
            if attempt.parent is not None:
                wanted.setdefault(attempt.tenant, set()).add((attempt.owner, attempt.parent))
    parents = _seed(session, memo, "record", wanted, Observation.id, kind="request")

    wanted = {}
    for r in pending:
        if r.role == "prompt" and r.payload["provider_request_key"]:
            wanted.setdefault(r.tenant, set()).add((r.owner, r.site, r.payload["provider_request_key"]))
    keyed = _seed(session, memo, "requests", wanted, Observation.stable_key, kind="request")

    wanted = {}
    records = [*(a for found in attempts for a in found), *parents, *(q for found in keyed for q in found)]
    for record in records:
        if record is not None:
            wanted.setdefault(record.tenant, set()).add((record.owner, record.kind, record.id))
    for tenant, keys in wanted.items():
        keys = {k for k in keys if ("tombstone", tenant, *k) not in memo}
        found = set()
        t = DeletionTombstone
        for owners, chunk in chunked(keys, lambda k: k[2]):
            found.update(
                tuple(row)
                for row in session.execute(
                    select(t.owner, t.kind, t.record_id).where(
                        t.tenant == tenant, t.owner.in_(owners), t.record_id.in_(chunk)
                    )
                )
            )
        for k in keys:
            memo[("tombstone", tenant, *k)] = k in found


def chunked(keys, value, size=500):
    """Yields (owners, values) per chunk of keys, whose first item is the owner."""
    keys = sorted(keys)
    for start in range(0, len(keys), size):
        chunk = keys[start : start + size]
        yield sorted({k[0] for k in chunk}), sorted({value(k) for k in chunk})


def _seed(session, memo, name, wanted, column, kind):
    """
    Reads the live records of one kind whose column holds a wanted value, per organization and
    owner, and remembers each wanted key's records as _attempts, _requests or _record would
    return them. wanted holds (owner, value) or (owner, site, value) per organization. Returns
    the remembered answers.
    """
    def memo_key(tenant, k):
        # _record's key names the kind between the owner and the id.
        return ("record", tenant, k[0], kind, k[1]) if name == "record" else (name, tenant, *k)

    answers = []
    for tenant, keys in wanted.items():
        keys = {k for k in keys if memo_key(tenant, k) not in memo}
        # A record can match the owner and value lists of more than one chunk; it counts once.
        records = {}
        for owners, chunk in chunked(keys, lambda k: k[-1]):
            for record in session.scalars(
                select(Observation).where(
                    Observation.tenant == tenant,
                    Observation.owner.in_(owners),
                    Observation.kind == kind,
                    column.in_(chunk),
                )
            ):
                records[(record.owner, record.kind, record.id)] = record
        found = {}
        for record in records.values():
            value = getattr(record, column.key)
            group = (record.owner, record.site, value) if name == "requests" else (record.owner, value)
            found.setdefault(group, []).append(record)
        for k in keys:
            matching = found.get(k, [])
            # _record answers as session.get does: the record with that primary key, or None.
            answer = (matching[0] if matching else None) if name == "record" else matching
            memo[memo_key(tenant, k)] = answer
            answers.append(answer)
    return answers


def _chat_rows(session, chats):
    """What _history_rows(site=..., conversation=...) returns for each chat in chats."""
    from .historical_usage import HistoricalUsage, load_rows

    by_tenant = {}
    for key, (tenant, owner, site, conversation) in chats.items():
        by_tenant.setdefault(tenant, set()).add((owner, conversation))
    rows = {}
    for tenant, keys in by_tenant.items():
        for owners, chunk in chunked(keys, lambda k: k[1]):
            for row in load_rows(
                session,
                [
                    HistoryObservation.tenant == tenant,
                    HistoryObservation.owner.in_(owners),
                    HistoryObservation.status == "current",
                    HistoryObservation.conversation.in_(chunk),
                    HistoricalUsage(None).visible(None),
                ],
            ):
                # A row can match the owner and chat lists of more than one chunk; it counts once.
                rows[(row.tenant, row.owner, row.message_key)] = row
    found = {}
    for row in rows.values():
        if _hash_holds(session, row):
            key = _rows_key(row.tenant, row.owner, {"site": row.site, "conversation": row.conversation})
            found.setdefault(key, []).append(row)
    return {key: found.get(key, []) for key in chats}


def linked_history(session, tenant, owner, attempt, request):
    if not tenant or not owner or not attempt.get("provider_attempt_key"):
        return None
    matches = []
    for row in _history_rows(
        session, tenant, owner, site=request["site"], provider_attempt_key=attempt["provider_attempt_key"]
    ):
        if row.role != "response" or row.payload["provider_attempt_key"] != attempt["provider_attempt_key"]:
            continue
        resolved = resolve_history_live(session, row)
        if (
            resolved
            and resolved[1] is not None
            and resolved[1].id == attempt["attempt_id"]
            and resolved[0].id == request["request_id"]
        ):
            matches.append(row)
    return matches[0] if len(matches) == 1 else None
