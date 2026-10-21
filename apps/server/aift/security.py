import base64
import hashlib
import hmac
import ipaddress
import json
import re
import secrets
from datetime import UTC, datetime
from uuid import uuid4

import idna
from cryptography.fernet import Fernet


class Problem(Exception):
    def __init__(self, code, status=400, retryable=False, retry_after=None):
        self.code, self.status, self.retryable = code, status, retryable
        # Whole seconds until the same request can succeed, when a limit knows it.
        self.retry_after = retry_after


def uid():
    return str(uuid4())


def token():
    return secrets.token_urlsafe(32)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def instant(value=None):
    return (value or datetime.now(UTC)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def normalize_domain(value):
    try:
        domain = idna.encode(value.strip(), uts46=True).decode().lower()
    except idna.IDNAError:
        raise Problem("invalid_domain") from None
    if "." not in domain or len(domain) > 253:
        raise Problem("invalid_domain")
    return domain


def normalize_email(value):
    value = value.strip()
    if value.count("@") != 1:
        raise Problem("invalid_email")
    local, domain = value.split("@")
    if not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}", local):
        raise Problem("invalid_email")
    return local + "@" + normalize_domain(domain)


def folded_email(value):
    """An address with only its case ignored, for matching configured addresses exactly."""
    local, domain = normalize_email(value).split("@")
    return local.lower() + "@" + domain


def email_identity(value):
    """
    The form of a work address that names one person: seats, code limits, erasure blocking and
    registration duplicates key on it. It never decides where a code goes: an existing member's
    code goes to their stored address (Service.delivery_address), so a variant mailbox never
    receives a code that acts as them.

    RFC 5321 lets a mail server treat the local part case-sensitively, but no mainstream provider
    does, so Bob@ and bob@ are one person. A "+tag" reaches the same mailbox at the providers that
    support subaddressing, so bob+ai@ is bob@ too; otherwise one person could hold several seats or
    rejoin after an erasure.
    """
    local, domain = normalize_email(value).split("@")
    local = local.lower().split("+", 1)[0]
    if not local:
        raise Problem("invalid_email")
    return local + "@" + domain


class Secrets:
    def __init__(self, settings):
        self.cipher = Fernet(settings.encryption_key.encode())
        self.lookup = settings.lookup_key.encode()
        self.active_ip_key_version = settings.active_ip_key_version
        # With IP collection off the keyring stays empty, so any IP use fails with
        # ip_key_unavailable instead of quietly falling back to another key.
        keyring = settings.ip_keyring() if settings.ip_collection_enabled else {}
        self.ip_keys = {version: key.encode() for version, key in keyring.items()}
        self.ip_ciphers = {
            version: Fernet(
                base64.urlsafe_b64encode(hmac.new(key, b"ip-encryption-v1", hashlib.sha256).digest())
            )
            for version, key in self.ip_keys.items()
        }

    def encrypt(self, value):
        return self.cipher.encrypt(canonical(value).encode()).decode()

    def decrypt(self, value):
        return json.loads(self.cipher.decrypt(value.encode()))

    def ip_material(self, key_version=None):
        version = key_version or self.active_ip_key_version
        if version not in self.ip_keys:
            raise Problem("ip_key_unavailable", 503)
        return self.ip_keys[version]

    def encrypt_ip(self, value, key_version=None):
        version = key_version or self.active_ip_key_version
        self.ip_material(version)
        return self.ip_ciphers[version].encrypt(value.encode()).decode()

    def decrypt_ip(self, value, key_version="1"):
        self.ip_material(key_version)
        try:
            return self.ip_ciphers[key_version].decrypt(value.encode()).decode()
        except Exception:
            raise Problem("ip_decryption_failed", 503) from None

    def keyed(self, scope, value, ip=False, key_version=None):
        return hmac.new(
            self.ip_material(key_version) if ip else self.lookup,
            (scope + "\0" + value).encode(),
            hashlib.sha256,
        ).hexdigest()


def connection_ip(peer, forwarded, trusted_cidrs):
    try:
        address = ipaddress.ip_address(peer)
        trusted = [ipaddress.ip_network(cidr) for cidr in trusted_cidrs]
        if any(address in network for network in trusted):
            if not forwarded:
                return None
            chain = [ipaddress.ip_address(item.strip()) for item in forwarded.split(",")]
            if len(chain) > 16:
                return None
            while chain and any(address in network for network in trusted):
                address = chain.pop()
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
            address = address.ipv4_mapped
        return str(address)
    except ValueError:
        return None


def extension_origin_allowed(origin, configured):
    if origin in configured:
        return True
    # Firefox's installation UUID is not a package or user identity. Proof/Bearer checks remain mandatory.
    return (
        isinstance(origin, str)
        and re.fullmatch(r"moz-extension://[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", origin)
        is not None
    )
