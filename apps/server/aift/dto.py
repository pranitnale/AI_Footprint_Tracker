from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

Short = Annotated[str, StringConstraints(min_length=1, max_length=200)]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Proof = Annotated[str, StringConstraints(min_length=32, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]
Version = Annotated[str, StringConstraints(pattern=r"^[0-9]+\.[0-9]+\.[0-9]+$", max_length=24)]


def valid_instant(value):
    datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")
    return value


Instant = Annotated[
    str,
    StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"),
    AfterValidator(valid_instant),
]


class DTO(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Registration(DTO):
    company_name: Short
    website: Annotated[str, StringConstraints(max_length=253, pattern=r"^https://[^\s]+$")]
    country: Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}$")]
    work_domain: Annotated[str, StringConstraints(max_length=253)]
    admin_email: Annotated[str, StringConstraints(max_length=254)]
    registrant_name: Short
    registrant_role: Short
    terms_version: Version
    disclosure_version: Version
    authority_acknowledged: Literal[True]
    idempotency_key: UUID


class OTPRequest(DTO):
    purpose: Literal["registration", "login", "action_reauth", "operator_login", "operator_reauth"]
    dispatch_id: UUID
    email: Annotated[str, StringConstraints(max_length=254)]
    registration_id: UUID | None = None


class OTPVerify(DTO):
    challenge_id: UUID
    code: Annotated[str, StringConstraints(pattern=r"^[0-9]{6}$")]
    verification_id: UUID


class OTPResend(DTO):
    challenge_id: UUID
    dispatch_id: UUID


class ConnectionOTPRequest(DTO):
    email: Annotated[str, StringConstraints(max_length=254)]
    dispatch_id: UUID


class ConnectionCreate(DTO):
    verifier_challenge: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
    challenge_method: Literal["S256"]
    browser_family: Literal["chrome", "edge", "firefox"]
    protocol_version: Literal["1.0.0"]
    operation_id: UUID
    # The email code from step 1 proves who connects; it replaces the website approval.
    challenge_id: UUID
    code: Annotated[str, StringConstraints(pattern=r"^[0-9]{6}$")]
    resume_device_id: UUID | None = None
    installation_reconnect_secret: Proof | None = None

    @model_validator(mode="after")
    def resume_pair(self):
        if bool(self.resume_device_id) != bool(self.installation_reconnect_secret):
            raise ValueError("resume pair required")
        return self


class ConnectionProof(DTO):
    connection_id: UUID
    verifier: Proof


class ConnectionExchange(ConnectionProof):
    exchange_id: UUID
    # The member confirms in the extension what is shared, under the policy version it showed.
    policy_version: Version
    disclosure_acknowledged: Literal[True]


class Refresh(DTO):
    refresh_token: Proof
    operation_id: UUID


class RoleChange(DTO):
    role: Literal["admin", "user"]
    expected_version: Annotated[int, Field(ge=1)]
    idempotency_key: UUID
    reauth_token: Proof


class DeleteScope(DTO):
    scope: Literal["user", "range", "company"]
    user_id: UUID | None = None
    start: Instant | None = None
    end: Instant | None = None


class DeleteExecute(DTO):
    preview_token: Proof
    idempotency_key: UUID
    confirmed: Literal[True]
    reauth_token: Proof


class ReceiptStatus(DTO):
    device_id: UUID
    credential: Proof
    last_epoch: Annotated[int, Field(ge=0)]


class ReceiptAck(ReceiptStatus):
    purged: Literal[True]


class PolicyUpdate(DTO):
    expected_version: Version
    timezone: Short
    pause_mode: Literal["user_controlled", "disabled_by_company"]
    company_sharing: Literal["disabled", "threshold"]
    # How long usage is kept. Left out, the current choice stays; a period longer than the plan's is refused.
    usage_retention: Literal["until_deleted", "24", "12", "6", "3"] | None = None
    idempotency_key: UUID
    reauth_token: Proof


class PlanCreate(DTO):
    plan_id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,40}$")]
    version: Annotated[int, Field(ge=1)]
    member_capacity: Annotated[int, Field(ge=1, le=500)]
    retention_months: Annotated[int, Field(ge=1, le=120)] | None
    idempotency_key: UUID


class Assignment(DTO):
    expected_version: Annotated[int, Field(ge=1)]
    plan_id: Short
    plan_version: Annotated[int, Field(ge=1)]
    effective_at: Instant
    reason: Reason
    idempotency_key: UUID
    reauth_token: Proof


class ServiceStatus(DTO):
    expected_version: Annotated[int, Field(ge=1)]
    status: Literal["active", "suspended"]
    reason: Reason
    idempotency_key: UUID
    reauth_token: Proof


class DeviceRevoke(DTO):
    reauth_token: Proof
    reason: Literal["self_disconnect", "security"]


class AdminDeviceRevoke(DTO):
    reauth_token: Proof


class MemberStatus(DTO):
    status: Literal["active", "suspended"]
    expected_version: Annotated[int, Field(ge=1)]
    reauth_token: Proof


class OrganizationDeletion(DTO):
    reauth_token: Proof
    confirm_name: Annotated[str, StringConstraints(max_length=200)]


class TransitionAck(DTO):
    transition_id: UUID
    expected_version: Annotated[int, Field(ge=1)]
    confirmed: Literal[True]
    idempotency_key: UUID
    reauth_token: Proof


class NetworkAccess(DTO):
    reauth_token: Proof


class HealthReport(DTO):
    code: Literal[
        "capture_failed",
        "storage_failed",
        "sync_failed",
        "tokenizer_failed",
        "calculation_failed",
        "healthy",
        "not_reporting",
    ]
    site: Literal["chatgpt", "claude", "gemini", "perplexity", "notebooklm"] | None
    count: Annotated[int, Field(ge=0, le=1000000)]
    client_version: Version


class ExceptionGrant(DTO):
    expected_version: Annotated[int, Field(ge=1)]
    member_capacity: Annotated[int, Field(ge=1, le=500)]
    retention_months: Annotated[int, Field(ge=1, le=120)] | None
    effective_at: Instant
    expires_at: Instant
    reason: Reason
    idempotency_key: UUID
    reauth_token: Proof


class ExceptionRevoke(DTO):
    expected_version: Annotated[int, Field(ge=1)]
    reason: Reason
    idempotency_key: UUID
    transition_acknowledgement: UUID | None = None
    reauth_token: Proof


class ProvisionRetry(DTO):
    idempotency_key: UUID


class CompanyKeyEntry(DTO):
    """The browser's company key for one record of the batch; never stored (W11)."""

    kind: Literal["request", "attempt"]
    record_id: UUID
    company_dedup_key: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]


class UsageEnvelope(DTO):
    schema_version: Literal["3.0.0"]
    batch_id: UUID
    sent_at: Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")]
    client_version: Literal["0.1.0"]
    deletion_epoch: Annotated[int, Field(ge=0)]
    records: Annotated[list[dict], Field(min_length=1, max_length=100)]
    company_dedup_keys: Annotated[list[CompanyKeyEntry], Field(max_length=100)] | None = None


class ContactRequest(DTO):
    topic: Literal["larger_organization", "self_hosting", "other"]
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    email: Annotated[str, StringConstraints(max_length=254)]
    organization: Annotated[str, StringConstraints(strip_whitespace=True, max_length=160)] = ""
    # A size band from the Contact page, never an exact head count.
    people: Literal["51-100", "101-250", "251-1000", "1000+"] | None = None
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
    # Hidden from people and left empty; a filled value marks an automated sender.
    website: Annotated[str, StringConstraints(max_length=200)] = ""
    idempotency_key: UUID


class ContactStatus(DTO):
    status: Literal["new", "replied", "closed"]


class ContactDelete(DTO):
    idempotency_key: UUID
    reauth_token: Proof


class DomainClaimApproval(DTO):
    domain: Annotated[str, StringConstraints(max_length=253)]
    # Accepted and ignored: registrations no longer choose an address, so an exception names the
    # domain only. Kept optional so an older developer panel form is not refused.
    target_slug: (
        Annotated[str, StringConstraints(min_length=3, max_length=48, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")]
        | None
    ) = None
    expected_version: Annotated[int, Field(ge=0)]
    reason: Reason
    expires_at: Instant
    idempotency_key: UUID
    reauth_token: Proof


class ExportRequest(DTO):
    format: Literal["csv"] = "csv"
    report: Literal["summary", "records"] = "summary"
    period: Literal["week", "month", "all", "custom"] = "month"
    start: Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$")] | None = None
    end: Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$")] | None = None
    site: Literal["chatgpt", "claude", "gemini", "perplexity", "notebooklm"] | None = None
    model: Annotated[str, StringConstraints(max_length=128)] | None = None
    user_id: UUID | None = None
    calculation_view: Literal["original", "recalculated"] = "original"
    method_id: Annotated[str, StringConstraints(min_length=1, max_length=128)] | None = None
    idempotency_key: UUID
    reauth_token: Proof


class TransitionDecision(DTO):
    expected_version: Annotated[int, Field(ge=1)]
    expected_company_version: Annotated[int, Field(ge=1)]
    reason: Reason
    confirmed: Literal[True]
    idempotency_key: UUID
    # Developer panel sessions last 7 days, so every entitlement change needs a fresh email code.
    reauth_token: Proof


class ExceptionReplace(TransitionDecision):
    expected_transition_version: Annotated[int, Field(ge=1)]
    expected_entitlement_generation: Annotated[int, Field(ge=0)]
    plan_id: Short
    plan_version: Annotated[int, Field(ge=1)]
