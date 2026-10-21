from contextlib import contextmanager

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    create_engine,
    event,
    false,
    select,
    text,
)
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column


class Base(DeclarativeBase):
    pass


# The schema the code expects. The newest migration sets it, and readiness and the restore
# gate refuse any other, so one place names it.
SCHEMA_VERSION = 14


class Guard(Base):
    __tablename__ = "transaction_guard"
    id: Mapped[int] = mapped_column(primary_key=True)
    schema_version: Mapped[int] = mapped_column(default=SCHEMA_VERSION)


class State:
    """Persisted protocol payload, with constrained relational identity in each concrete table."""

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    tenant: Mapped[str] = mapped_column(String(36), index=True, default="")
    owner: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    data: Mapped[dict] = mapped_column(JSON)


class Company(State, Base):
    __tablename__ = "companies"
    origin: Mapped[str] = mapped_column(String(253), unique=True)
    slug: Mapped[str] = mapped_column(String(48), unique=True)
    domain: Mapped[str] = mapped_column(String(253), index=True)


class Member(State, Base):
    __tablename__ = "memberships"
    role: Mapped[str] = mapped_column(String(5))
    status: Mapped[str] = mapped_column(String(16))
    version: Mapped[int] = mapped_column(Integer)
    __table_args__ = (
        UniqueConstraint("tenant", "id"),
        ForeignKeyConstraint(["tenant"], ["companies.id"]),
        CheckConstraint("role IN ('user', 'admin')"),
        CheckConstraint("version >= 1"),
        Index("ix_membership_active_role", "tenant", "status", "role"),
    )


class EmailIdentity(State, Base):
    __tablename__ = "email_identities"
    __table_args__ = (
        UniqueConstraint("tenant", "owner"),
        ForeignKeyConstraint(["tenant", "owner"], ["memberships.tenant", "memberships.id"]),
    )


class Device(State, Base):
    __tablename__ = "devices"
    status: Mapped[str] = mapped_column(String(16))
    browser_family: Mapped[str] = mapped_column(String(8))
    __table_args__ = (
        UniqueConstraint("tenant", "owner", "id"),
        ForeignKeyConstraint(["tenant", "owner"], ["memberships.tenant", "memberships.id"]),
        CheckConstraint("browser_family IN ('chrome', 'edge', 'firefox')"),
    )


TABLES = {"company": Company, "member": Member, "email": EmailIdentity, "device": Device}
TABLE_NAMES = {
    "registration": "registration_drafts",
    "registration_operation": "registration_operations",
    "otp": "otp_challenges",
    "dispatch": "mail_dispatches",
    "connection": "installation_connections",
    "connection_operation": "connection_operations",
    "reauth": "action_authorizations",
    "deletion_receipt": "deletion_receipt_credentials",
    "audit": "audit_events",
    "rate": "abuse_buckets",
    "bootstrap": "registration_bootstraps",
    "revision": "observation_revisions",
    "receipt": "ingestion_receipts",
    "deletion_preview": "deletion_previews",
    "deletion_job": "deletion_jobs",
    "plan": "plan_versions",
    "transition": "plan_transitions",
    "exception": "operator_exceptions",
    "health": "device_health",
    "export": "export_jobs",
    "role_operation": "role_operations",
    "resend_operation": "otp_resend_operations",
    "entitlement_operation": "entitlement_operations",
    "alias": "observation_aliases",
    "retention": "retention_cutoffs",
    "policy": "company_policy_versions",
    "policy_receipt": "installation_policy_receipts",
    "maintenance_cursor": "maintenance_cursors",
    "disconnect_operation": "disconnect_operations",
    "domain_claim": "operator_domain_claim_approvals",
    "diagnostic": "safe_diagnostics",
    "diagnostic_counter": "safe_diagnostic_counters",
    "export_chunk": "encrypted_export_chunks",
    "contact": "contact_requests",
}
for kind, table_name in TABLE_NAMES.items():
    fields = {}
    if kind in {"revision", "receipt"}:
        fields = {
            "record_id": mapped_column(String(36), index=True),
            "record_kind": mapped_column(String(10)),
            "__table_args__": (
                Index("ix_" + kind + "_record", "tenant", "owner", "record_kind", "record_id"),
            ),
        }
    TABLES[kind] = type(
        "".join(word.title() for word in kind.split("_")),
        (State, Base),
        {"__tablename__": table_name, **fields},
    )


class WebSession(State, Base):
    __tablename__ = "web_sessions"
    purpose: Mapped[str] = mapped_column(String(16))
    expires_at: Mapped[str] = mapped_column(String(24), index=True)
    last_seen_at: Mapped[str] = mapped_column(String(24), index=True)
    __table_args__ = (CheckConstraint("purpose IN ('tenant', 'registration', 'operator')"),)


class EnrollmentEra(State, Base):
    __tablename__ = "installation_enrollment_eras"
    device_id: Mapped[str] = mapped_column(String(36), index=True)
    started_at: Mapped[str] = mapped_column(String(24), index=True)
    ended_at: Mapped[str | None] = mapped_column(String(24))
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant", "owner", "device_id"], ["devices.tenant", "devices.owner", "devices.id"]
        ),
    )


class Family(State, Base):
    __tablename__ = "credential_families"
    device_id: Mapped[str] = mapped_column(String(36), index=True)
    __table_args__ = (
        UniqueConstraint("tenant", "owner", "id"),
        ForeignKeyConstraint(
            ["tenant", "owner", "device_id"], ["devices.tenant", "devices.owner", "devices.id"]
        ),
    )


class Credential(State):
    expires_at: Mapped[str] = mapped_column(String(24), index=True)
    family_id: Mapped[str] = mapped_column(String(36), index=True)
    device_id: Mapped[str] = mapped_column(String(36), index=True)


for kind, name in (("access", "access_credentials"), ("refresh", "refresh_credentials")):
    TABLES[kind] = type(
        kind.title() + "Credential",
        (Credential, Base),
        {
            "__tablename__": name,
            "__table_args__": (
                ForeignKeyConstraint(
                    ["tenant", "owner", "device_id"], ["devices.tenant", "devices.owner", "devices.id"]
                ),
                ForeignKeyConstraint(
                    ["tenant", "owner", "family_id"],
                    ["credential_families.tenant", "credential_families.owner", "credential_families.id"],
                ),
            ),
        },
    )
TABLES.update(session=WebSession, era=EnrollmentEra, family=Family)


class DailyRollup(State, Base):
    __tablename__ = "daily_usage_rollups"
    day: Mapped[str] = mapped_column(String(10))
    site: Mapped[str] = mapped_column(String(12))
    model: Mapped[str | None] = mapped_column(String(128))
    request_count: Mapped[int] = mapped_column(Integer)
    active_observation_count: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16))
    __table_args__ = (
        ForeignKeyConstraint(["tenant", "owner"], ["memberships.tenant", "memberships.id"]),
        Index("ix_rollup_period", "tenant", "day", "owner", "site", "model"),
        CheckConstraint("request_count >= 0"),
    )


TABLES["rollup"] = DailyRollup


class NetworkObservation(State, Base):
    __tablename__ = "network_observations"
    observed_at: Mapped[str] = mapped_column(String(24))
    device_id: Mapped[str] = mapped_column(String(36))
    equality: Mapped[str | None] = mapped_column(String(64))
    accepted_record_count: Mapped[int] = mapped_column(Integer)
    __table_args__ = (
        Index("ix_network_period", "tenant", "observed_at", "equality"),
        CheckConstraint("accepted_record_count >= 0"),
    )


TABLES["network"] = NetworkObservation


class DeletionScope(State, Base):
    __tablename__ = "deletion_markers"
    scope: Mapped[str] = mapped_column(String(16))
    deletion_user_id: Mapped[str | None] = mapped_column(String(36))
    range_start: Mapped[str] = mapped_column(String(24))
    range_end: Mapped[str] = mapped_column(String(24))
    epoch: Mapped[int] = mapped_column(Integer)
    __table_args__ = (
        Index("ix_deletion_scope", "tenant", "deletion_user_id", "range_start", "range_end"),
        Index("ix_deletion_epoch", "tenant", "epoch"),
    )


TABLES["deletion"] = DeletionScope


class DeletionTombstone(Base):
    __tablename__ = "record_deletion_tombstones"
    tenant: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(36), primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), primary_key=True)
    record_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    epoch: Mapped[int] = mapped_column(Integer)
    stable_key: Mapped[str | None] = mapped_column(String(64))
    reason: Mapped[str] = mapped_column(String(16), default="explicit")
    __table_args__ = (
        Index("ix_tombstone_delivery", "tenant", "owner", "epoch", "record_id"),
        Index("ix_tombstone_stable", "tenant", "owner", "kind", "stable_key"),
    )


class RequestAttemptLink(Base):
    __tablename__ = "request_attempt_links"
    tenant: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    attempt_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    reason: Mapped[str] = mapped_column(String(32), default="distinct_verified_dispatch")


class DeletionDeviceReceipt(Base):
    __tablename__ = "deletion_device_receipts"
    tenant: Mapped[str] = mapped_column(String(36), primary_key=True)
    job_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(36), index=True)
    epoch: Mapped[int] = mapped_column(Integer)


class DeletionPreviewTarget(Base):
    __tablename__ = "deletion_preview_targets"
    tenant: Mapped[str] = mapped_column(String(36), primary_key=True)
    preview_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    owner: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    __table_args__ = (Index("ix_preview_scope", "tenant", "preview_id", "request_id"),)


class Observation(Base):
    __tablename__ = "canonical_observations"
    tenant: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(36), primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), primary_key=True)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    device: Mapped[str] = mapped_column(String(36), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    parent: Mapped[str | None] = mapped_column(String(36), index=True)
    parent_kind: Mapped[str | None] = mapped_column(String(10))
    stable_key: Mapped[str | None] = mapped_column(String(64))
    payload_hash: Mapped[str] = mapped_column(String(64))
    occurred_at: Mapped[str] = mapped_column(String(24), index=True)
    site: Mapped[str] = mapped_column(String(12), index=True)
    model: Mapped[str | None] = mapped_column(String(128), index=True)
    conversation: Mapped[str] = mapped_column(String(64), index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    estimate: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(32), default="current")
    # The server's own hash of the browser's company key for this prompt or reply (W11).
    # The browser's key is never stored, so a leaked company key matches nothing here.
    company_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Another member's record counts this prompt or reply in period and company totals.
    company_shared: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    __table_args__ = (
        UniqueConstraint("tenant", "owner", "kind", "stable_key"),
        ForeignKeyConstraint(
            ["tenant", "owner", "device"], ["devices.tenant", "devices.owner", "devices.id"]
        ),
        ForeignKeyConstraint(
            ["tenant", "owner", "parent_kind", "parent"],
            [
                "canonical_observations.tenant",
                "canonical_observations.owner",
                "canonical_observations.kind",
                "canonical_observations.id",
            ],
        ),
        CheckConstraint("revision >= 1"),
        CheckConstraint("kind IN ('request', 'attempt')"),
        CheckConstraint(
            "(kind = 'request' AND parent IS NULL AND parent_kind IS NULL) OR (kind = 'attempt' AND parent IS NOT NULL AND parent_kind = 'request')"
        ),
        Index("ix_observation_tenant_occurrence", "tenant", "occurred_at", "owner"),
        Index("ix_observation_parent", "tenant", "owner", "parent"),
        Index("ix_observation_company_key", "tenant", "company_key"),
    )


class ThreadRelation(Base):
    __tablename__ = "recorded_thread_relations"
    tenant: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(36), primary_key=True)
    provider_request_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_kind: Mapped[str] = mapped_column(String(10), default="request")
    site: Mapped[str] = mapped_column(String(12), default="perplexity")
    key_version: Mapped[str] = mapped_column(String(1), default="1")
    thread_key: Mapped[str] = mapped_column(String(64))
    source: Mapped[str] = mapped_column(String(40), default="perplexity-thread-response-v1")
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant", "owner", "request_kind", "provider_request_key"],
            [
                "canonical_observations.tenant",
                "canonical_observations.owner",
                "canonical_observations.kind",
                "canonical_observations.stable_key",
            ],
            ondelete="CASCADE",
        ),
        CheckConstraint("request_kind = 'request' AND site = 'perplexity' AND key_version = '1'"),
        CheckConstraint("source = 'perplexity-thread-response-v1'"),
        CheckConstraint("length(provider_request_key) = 64 AND length(thread_key) = 64"),
        Index("ix_recorded_thread_lookup", "tenant", "owner", "thread_key"),
    )


# Connections each process may hold. The API runs several worker processes (WEB_CONCURRENCY in
# apps/server/Dockerfile, 4) and the maintenance worker is one more process, so the database sees
# up to (API processes + 1) * (POOL_SIZE + POOL_OVERFLOW) = 5 * 12 = 60 connections, well under
# PostgreSQL's default max_connections of 100 (compose.yaml does not change it). Raise
# max_connections before raising these or the process count.
POOL_SIZE = 8
POOL_OVERFLOW = 4
# PostgreSQL error raised by a write inside a READ ONLY transaction.
READ_ONLY_SQLSTATE = "25006"


class WriteNeeded(Exception):
    """A read-only attempt found that the request has to write; run it again under its lock."""


class Database:
    def __init__(self, settings, initialize=False):
        from . import engine_history  # noqa: F401  Register overlays before metadata creation.
        from .method_history import register_models

        register_models()
        kwargs = (
            {"connect_args": {"check_same_thread": False, "timeout": 30}}
            if settings.database_url.startswith("sqlite")
            else {
                "pool_size": POOL_SIZE,
                "max_overflow": POOL_OVERFLOW,
                # A connection PostgreSQL closed (restart, idle timeout) is replaced before use
                # instead of failing the request that drew it from the pool.
                "pool_pre_ping": True,
            }
        )
        self.engine = create_engine(settings.database_url, **kwargs)
        if self.engine.dialect.name == "sqlite":

            @event.listens_for(self.engine, "connect")
            def sqlite_foreign_keys(connection, record):
                connection.execute("PRAGMA foreign_keys=ON")

        if initialize:
            if settings.environment == "production":
                raise ValueError("Production schema requires Alembic migrations")
            Base.metadata.create_all(self.engine)
            with Session(self.engine) as session, session.begin():
                if not session.get(Guard, 1):
                    session.add(Guard(id=1))

    @contextmanager
    def transaction(self, scope="registration", readonly=False):
        with Session(self.engine, expire_on_commit=False) as session:
            # Tenant-scoped database locks protect last-admin, enrollment and erasure races.
            # Read snapshots never acquire a write lock. Different tenant mutations remain independent.
            if self.engine.dialect.name == "sqlite" and not readonly:
                session.execute(text("BEGIN IMMEDIATE"))
            elif self.engine.dialect.name == "postgresql" and not readonly:
                session.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:scope, 0))"), {"scope": scope}
                )
            elif self.engine.dialect.name == "postgresql":
                session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"))
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise

    @contextmanager
    def read_attempt(self):
        """
        A snapshot transaction without the organization's lock that refuses every write with
        WriteNeeded and never commits. A request that writes only now and then (GET /v1/config
        saves a changed policy) runs here first, so it does not wait behind the worker's tick
        or an upload holding the lock, and runs again in transaction() only when it must write.
        """
        with Session(self.engine, expire_on_commit=False) as session:
            if self.engine.dialect.name == "postgresql":
                session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))

            def refuse_flush(session, flush_context, instances):
                # An attribute set to the value it had is not a write.
                if session.new or session.deleted or any(session.is_modified(row) for row in session.dirty):
                    raise WriteNeeded

            def refuse_statement(state):
                if state.is_insert or state.is_update or state.is_delete:
                    raise WriteNeeded

            event.listen(session, "before_flush", refuse_flush)
            event.listen(session, "do_orm_execute", refuse_statement)
            try:
                yield session
                # Changes still pending (no query flushed them yet) are writes too.
                session.flush()
            except DBAPIError as exc:
                if getattr(exc.orig, "sqlstate", None) == READ_ONLY_SQLSTATE:
                    raise WriteNeeded from exc
                raise
            finally:
                session.rollback()


def get(session, kind, key, tenant=None):
    entity = session.get(TABLES[kind], str(key))
    if entity and tenant is not None and entity.tenant != tenant:
        return None
    return entity


def put(session, kind, key, data, tenant="", owner=None):
    entity = get(session, kind, key)
    if entity is None:
        entity = TABLES[kind](id=str(key), tenant=tenant, owner=owner or None, data=data)
        session.add(entity)
    else:
        if entity.tenant != tenant or entity.owner != (owner or None):
            from .security import Problem

            raise Problem("state_scope_conflict", 409)
        entity.data = data
    project(entity, kind)
    session.flush()
    return entity


def rows(session, kind, tenant=None, owner=None):
    cls = TABLES[kind]
    query = select(cls)
    if tenant is not None:
        query = query.where(cls.tenant == tenant)
    if owner is not None:
        query = query.where(cls.owner == owner)
    return list(session.scalars(query))


def page(session, kind, tenant=None, owner=None, after="", limit=100):
    """Stable bounded SQL keyset page for protocol workers and administrative lists."""
    cls = TABLES[kind]
    query = select(cls).where(cls.id > after)
    if tenant is not None:
        query = query.where(cls.tenant == tenant)
    if owner is not None:
        query = query.where(cls.owner == owner)
    return list(session.scalars(query.order_by(cls.id).limit(limit)))


def project(entity, kind):
    if kind == "deletion":
        entity.scope, entity.deletion_user_id, entity.range_start, entity.range_end, entity.epoch = (
            entity.data[key] for key in ("scope", "user_id", "start", "end", "epoch")
        )
    if kind == "session" and entity.last_seen_at is None:
        entity.last_seen_at = entity.data["last_seen"]
    if kind in {"revision", "receipt"}:
        entity.record_id = entity.data["record_id"]
        entity.record_kind = entity.data["kind"]
    fields = {
        "company": ("origin", "slug", "domain"),
        "member": ("role", "status", "version"),
        "device": ("status", "browser_family"),
    }
    for key in fields.get(kind, ()):
        setattr(entity, key, entity.data[key])
    mapped_fields = {
        "session": {"purpose": "purpose", "expires_at": "expires"},
        "era": {"device_id": "device", "started_at": "start", "ended_at": "end"},
        "family": {"device_id": "device"},
        "access": {"device_id": "device", "family_id": "family", "expires_at": "expires"},
        "refresh": {"device_id": "device", "family_id": "family", "expires_at": "expires"},
    }
    for column, field in mapped_fields.get(kind, {}).items():
        setattr(entity, column, entity.data[field])
    if kind == "rollup":
        entity.day, entity.site, entity.model, entity.status = (
            entity.data[k] for k in ("day", "site", "model", "status")
        )
        entity.request_count = int(entity.data["value"]["request_count"])
        entity.active_observation_count = sum(
            int(entity.data["value"].get(field, 0))
            for field in (
                "request_count",
                "attempt_count",
                "unconfirmed_attempt_count",
                "unresolved_request_count",
            )
        )
    if kind == "network":
        for column in ("observed_at", "device_id", "equality", "accepted_record_count"):
            setattr(entity, column, entity.data[column])


@event.listens_for(Session, "before_flush")
def update_projections(session, flush_context, instances):
    for obj in session.dirty:
        for kind in (
            "company",
            "member",
            "device",
            "session",
            "era",
            "family",
            "access",
            "refresh",
            "rollup",
            "network",
            "revision",
            "receipt",
            "deletion",
        ):
            if isinstance(obj, TABLES[kind]):
                project(obj, kind)


@event.listens_for(TABLES["policy"], "before_update")
@event.listens_for(TABLES["policy_receipt"], "before_update")
def immutable_policy(mapper, connection, target):
    raise ValueError("immutable_policy_history")


@event.listens_for(DeletionScope, "before_update")
def immutable_deletion_scope(mapper, connection, target):
    from sqlalchemy import inspect

    from .security import Problem

    if any(attribute.history.has_changes() for attribute in inspect(target).attrs):
        raise Problem("immutable_deletion_scope", 409)


class HistoryObservation(Base):
    __tablename__ = "historical_observations"
    tenant: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(36), primary_key=True)
    message_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    device: Mapped[str] = mapped_column(String(36))
    conversation: Mapped[str] = mapped_column(String(64))
    role: Mapped[str] = mapped_column(String(8))
    site: Mapped[str] = mapped_column(String(12))
    occurred_at: Mapped[str | None] = mapped_column(String(27))
    observed_at: Mapped[str] = mapped_column(String(24))
    payload: Mapped[dict] = mapped_column(JSON)
    original: Mapped[dict] = mapped_column(JSON)
    payload_hash: Mapped[str] = mapped_column(String(64))
    estimate: Mapped[list] = mapped_column(JSON)
    original_estimate: Mapped[list] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16))
    # As on live records (W11): the server's hash of the company key and whether another
    # member's record counts this message.
    company_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    company_shared: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant", "owner", "device"], ["devices.tenant", "devices.owner", "devices.id"]
        ),
        CheckConstraint("role IN ('prompt','response') AND status IN ('current','conflict')"),
        Index("ix_history_conversation", "tenant", "owner", "conversation", "message_key"),
        Index("ix_history_date", "tenant", "occurred_at", "owner", "message_key"),
        Index("ix_history_company_key", "tenant", "company_key"),
    )


class HistoryCoverage(Base):
    __tablename__ = "historical_coverage"
    tenant: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(36), primary_key=True)
    conversation: Mapped[str] = mapped_column(String(64), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)


class HistoryTombstone(Base):
    __tablename__ = "historical_tombstones"
    tenant: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(36), primary_key=True)
    message_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    epoch: Mapped[int] = mapped_column(Integer)
