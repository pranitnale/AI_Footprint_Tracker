import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Settings:
    database_url: str
    environment: str = "production"
    mode: str = "hosted"
    registration_origin: str = "https://aifootprinttracker.com"
    # The developer panel (owner decision, 11 Oct 2026); no link leads there from the public site.
    operator_origin: str = "https://developer.aifootprinttracker.com"
    hosted_domain: str = "aifootprinttracker.com"
    self_host_origin: str | None = None
    encryption_key: str = ""
    lookup_key: str = ""
    # Operator-level switches (owner decision of 18 October 2026). Both are off by default and no
    # organization administrator can change them. Turning either on needs updated privacy texts, a
    # new member consent text in the extension's connect dialog and, in Germany, a works agreement.
    # person_analytics_enabled restores the per-person admin views (usage per member, request lists,
    # per-person exports, per-browser health); ip_collection_enabled restores the collection of
    # encrypted connection addresses and the Network page. See docs/operations/SELF-HOSTING.md.
    person_analytics_enabled: bool = False
    ip_collection_enabled: bool = False
    # The IP key settings below are read only while ip_collection_enabled is on. While it is off
    # they are accepted and ignored, so a settings file written for an earlier release still starts.
    ip_key: str = field(default="", repr=False)
    ip_keys: dict[str, str] = field(default_factory=dict, repr=False)
    active_ip_key_version: str = "1"
    ip_restore_required_until: dict[str, str] = field(default_factory=dict)
    operator_emails: tuple[str, ...] = ()
    extension_origins: tuple[str, ...] = ()
    trusted_proxy_cidrs: tuple[str, ...] = ()
    mail_adapter: str = "brevo"
    brevo_key: str = ""
    brevo_sender: str = ""
    ip_retention_days: int | None = None
    member_capacity: int | None = None
    domain_policy: str | None = None
    routing_verified: bool = False
    mail_privacy_verified: bool = False
    # The designed HTML code email goes out only after a delivered one was checked for tracking
    # pixels and rewritten links; until then the plain-text version is sent (13 Oct 2026).
    mail_html_verified: bool = False
    operator_risk_accepted: bool = False
    policy_confirmed: bool = False
    global_mail_daily: int = 250
    # Registration codes may use at most this part of global_mail_daily; the rest is kept for
    # people of existing organizations, so anonymous registrations cannot lock them out.
    registration_mail_daily: int = 50
    tenant_mail_daily: int = 100
    support_contact: str = ""
    privacy_contact: str = ""
    security_contact: str = ""
    restore_journal_verified: bool = False
    deletion_signing_key: str = ""
    method_public_key: str = ""
    deletion_journal_path: str = ""
    worker_max_age_seconds: int = 300

    def validate(self):
        if self.method_public_key:
            from .method_registry import public_key_bytes

            public_key_bytes(self.method_public_key)
        if self.environment not in {"test", "development", "production"}:
            raise ValueError("configuration_required: environment")
        if self.mode not in {"hosted", "self_hosted"}:
            raise ValueError("configuration_required: mode")
        for origin in (self.registration_origin, self.operator_origin, self.self_host_origin):
            if origin:
                parsed = urlsplit(origin)
                if (
                    parsed.scheme != "https"
                    or not parsed.hostname
                    or parsed.path
                    or parsed.query
                    or parsed.fragment
                    or parsed.username
                ):
                    raise ValueError("configuration_required: exact HTTPS origin")
        if not 1 <= self.registration_mail_daily < self.global_mail_daily:
            raise ValueError("configuration_required: registration mail share below the global budget")
        if self.mode == "self_hosted" and not self.self_host_origin:
            raise ValueError("configuration_required: self_host_origin")
        if self.environment == "production":
            essentials = [
                self.database_url.startswith("postgresql"),
                self.encryption_key,
                self.lookup_key,
                self.ip_key or self.ip_keys or not self.ip_collection_enabled,
                self.deletion_signing_key,
                self.deletion_journal_path,
                self.ip_retention_days or not self.ip_collection_enabled,
                self.member_capacity,
                self.domain_policy,
                self.policy_confirmed,
                self.routing_verified,
                self.mail_privacy_verified,
                self.restore_journal_verified,
                self.support_contact,
                self.privacy_contact,
                self.security_contact,
                self.mail_adapter == "brevo",
                self.brevo_key,
                self.brevo_sender,
                self.operator_risk_accepted or self.mode == "self_hosted",
            ]
            if not all(essentials):
                raise ValueError("configuration_required: production release essentials are incomplete")
        if self.mail_adapter == "fake" and self.environment == "production":
            raise ValueError("configuration_required: fake mail prohibited")
        if not isinstance(self.person_analytics_enabled, bool) or not isinstance(self.ip_collection_enabled, bool):
            raise ValueError("configuration_required: feature switches must be true or false")
        keys = self.ip_keyring() if self.ip_collection_enabled else {}
        if len({self.encryption_key, self.lookup_key, *keys.values()}) != len(keys) + 2:
            raise ValueError("configuration_required: independent keys required")
        if min([len(self.lookup_key), *(len(key) for key in keys.values())]) < 32:
            raise ValueError("configuration_required: keys need at least 256-bit generated secrets")
        if self.domain_policy not in {"one_active", "multiple_reviewed"}:
            raise ValueError("configuration_required: domain policy")
        if not self.member_capacity or not 1 <= self.member_capacity <= 500:
            raise ValueError("configuration_required: member capacity")
        if self.ip_collection_enabled and (not self.ip_retention_days or self.ip_retention_days < 1):
            raise ValueError("configuration_required: IP retention")

    def ip_keyring(self):
        import re
        from datetime import datetime

        if not isinstance(self.ip_keys, dict) or not isinstance(self.ip_restore_required_until, dict):
            raise ValueError("configuration_required: IP keyring")
        keys = dict(self.ip_keys)
        if self.ip_key:
            if "1" in keys and keys["1"] != self.ip_key:
                raise ValueError("configuration_required: conflicting legacy IP key")
            keys["1"] = self.ip_key
        if not 1 <= len(keys) <= 8 or self.active_ip_key_version not in keys:
            raise ValueError("configuration_required: active IP key version")
        for version, key in keys.items():
            if not isinstance(version, str) or not re.fullmatch(r"[1-9][0-9]{0,3}", version):
                raise ValueError("configuration_required: IP key version")
            if not isinstance(key, str) or len(key) < 32:
                raise ValueError("configuration_required: IP key material")
        for version, horizon in self.ip_restore_required_until.items():
            if version not in keys or not isinstance(horizon, str):
                raise ValueError("configuration_required: IP restore policy")
            try:
                if datetime.fromisoformat(horizon.replace("Z", "+00:00")).tzinfo is None:
                    raise ValueError()
            except ValueError:
                raise ValueError("configuration_required: IP restore policy") from None
        return keys

    @classmethod
    def from_environment(cls):
        path = os.environ.get("AIFT_SETTINGS_FILE")
        if not path:
            raise ValueError("configuration_required: AIFT_SETTINGS_FILE")
        values = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(**values)
