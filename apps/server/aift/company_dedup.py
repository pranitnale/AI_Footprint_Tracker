"""One record counts each prompt or reply for the company (W11, owner decisions 30 Sep and 2 Oct).

Members of one company can open the same chat, for example on a shared provider account.
Each browser sends, beside its records, an HMAC of the provider's prompt or reply id under
a company key. The server hashes it again with its own lookup secret and keeps only that
hash on the record. Among the records with the same hash, one wins by evidence: exact
provider counts, then a complete live count, a partial live count, a complete saved count,
a partial saved count, and last copies that measured nothing; then the earliest, owner and
id. A reply seen live so stays with the member who sent it, unless that copy measured
nothing. The winner's owner keeps its records as they are; every record of another owner
is marked shared and left out of period and company totals.
Conversation views still show it, so a member who opens a coworker's chat sees its figures.

The hash is used only to choose; admin screens never join or filter on it.
"""

from collections import defaultdict

from sqlalchemy import select

from .db import HistoryObservation, Observation, get
from .method_history import select_records
from .security import Problem, token

KEY_SCOPE = "company-dedup:"


def browser_key(service, company):
    """The company's key for browsers, created on first use and stored encrypted."""
    stored = company.data.get("dedup_key")
    if not stored:
        stored = service.secrets.encrypt(token())
        company.data = {**company.data, "dedup_key": stored}
    return service.secrets.decrypt(stored)


def server_key(service, company, value):
    """The stored hash of a browser key; without the server secret it cannot be recomputed."""
    return service.secrets.keyed(KEY_SCOPE + company.id, value)


def _quality(total, ended):
    """How a copy measured its text: exact (0), complete (1), partial (2) or not at all (3)."""
    if total["value"] is None:
        return 3
    if total["evidence"] == "provider_reported":
        return 0
    return 1 if ended and total["completeness"] == "complete_for_scope" else 2


# Ranks by measurement and source. Measured live copies come before saved ones; a live copy
# that measured nothing comes after every measured saved copy, so totals keep a known count.
LIVE_TIERS = (0, 1, 2, 5)
SAVED_TIERS = (0, 3, 4, 6)


def live_rank(record):
    payload = record.payload
    if record.kind == "request":
        # A prompt captured live is the one its owner sent, read in full.
        quality = 1
    else:
        # A stopped reply ended too; one still running or cut off is not complete.
        quality = _quality(payload["tokens"]["output_total"], payload["state"] in ("completed", "cancelled"))
    return (LIVE_TIERS[quality], 0, record.occurred_at, record.owner, record.id)


def saved_rank(row):
    message = row.payload
    quality = _quality(message["tokens"], message["text_complete"])
    # The first member who opened a saved copy is the one who first observed it.
    return (SAVED_TIERS[quality], 1, row.observed_at, row.owner, row.message_key)


class CompanyDedup:
    def __init__(self, analytics):
        self.analytics = analytics

    def key_entries(self, company, entries, identities, identity, error="invalid_observation"):
        """Server keys by record identity from a batch's or page's list of browser keys.

        Each entry names one record of the same upload, at most once.
        """
        if entries is None:
            return {}
        keys = {}
        for entry in entries:
            name = identity(entry)
            if name not in identities or name in keys:
                raise Problem(error, 422)
            keys[name] = server_key(self.analytics.service, company, entry["company_dedup_key"])
        return keys

    def expected(self, s, company, key):
        """The live records and saved rows of one key, and whether each should be shared."""
        return self.expected_many(s, company, [key]).get(key, ([], [], {}))

    def expected_many(self, s, company, keys):
        """For each key, its live records and saved rows, and whether each should be shared.

        Reads only, so the restore gate can check restored flags by the same rules. Three
        queries serve the whole list, so the gate checks a page of keys at a time.
        """
        live, saved = defaultdict(list), defaultdict(list)
        for record in s.scalars(
            select(Observation).where(Observation.tenant == company.id, Observation.company_key.in_(keys))
        ):
            live[record.company_key].append(record)
        for row in s.scalars(
            select(HistoryObservation).where(
                HistoryObservation.tenant == company.id, HistoryObservation.company_key.in_(keys)
            )
        ):
            saved[row.company_key].append(row)
        visible = set()
        if saved:
            for owner, message_key in s.execute(
                select(HistoryObservation.owner, HistoryObservation.message_key).where(
                    HistoryObservation.tenant == company.id,
                    HistoryObservation.company_key.in_(keys),
                    HistoryObservation.status == "current",
                    self.analytics.history.visible(company),
                )
            ):
                visible.add((owner, message_key))
        elections = {}
        for key in {*live, *saved}:
            # Aliased live copies and conflicting or erased saved rows never count, so they
            # cannot win and are never marked shared.
            candidates = [(live_rank(r), r) for r in live[key] if r.status != "aliased"] + [
                (saved_rank(r), r) for r in saved[key] if (r.owner, r.message_key) in visible
            ]
            winner = min(candidates, key=lambda pair: pair[0])[1].owner if candidates else None
            chosen = {id(record) for _, record in candidates}
            flags = {id(r): id(r) in chosen and r.owner != winner for r in [*live[key], *saved[key]]}
            elections[key] = (live[key], saved[key], flags)
        return elections

    def elect(self, s, company, key, pending=None):
        """Chooses the record that counts for one key and moves rollup contributions.

        `pending` is a live record whose own contribution the caller adds after this call,
        so only its flag is set here.
        """
        if not key:
            return
        s.flush()
        live, saved, expected = self.expected(s, company, key)
        for record in live:
            shared = expected[id(record)]
            if record.company_shared == shared:
                continue
            if record is pending:
                record.company_shared = shared
                continue
            member = get(s, "member", record.owner, company.id)
            if shared:
                # Remove the counted contribution first, while the record still counts.
                self.analytics.contribution_delta(s, company, member, next(select_records(s, [record])), -1)
                record.company_shared = True
            else:
                record.company_shared = False
                self.analytics.contribution_delta(s, company, member, next(select_records(s, [record])), 1)
        for row in saved:
            row.company_shared = expected[id(row)]
        s.flush()
