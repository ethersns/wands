"""Bearer authentication.

Two credential types share one header:

* the **service token** (``WANDS_ENGINE_TOKEN``) used by the Next.js BFF. It is
  server-to-server only, never reaches a browser, and is therefore exempt from
  MFA — there is no human to challenge.
* **API keys** (``wands_<prefix>_<secret>``) for operators. Only a SHA-256 hash
  of the secret half is stored, so a database read cannot recover a usable key.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.config import Settings, get_settings
from wands.db.models import ApiKey, User
from wands.errors import Unauthorized
from wands.security.rbac import Role, parse_role

API_KEY_PREFIX = "wands"
ALL_SCOPES = frozenset(
    {
        "engine:read",
        "engine:control",
        "portfolio:read",
        "markets:read",
        "strategies:read",
        "strategies:write",
        "bots:read",
        "bots:write",
        "orders:read",
        "orders:write",
        "risk:read",
        "risk:write",
        "connections:read",
        "connections:write",
        "settings:read",
        "settings:write",
        "audit:read",
    }
)


@dataclass(frozen=True)
class Principal:
    subject: str
    role: Role
    scopes: frozenset[str] = field(default_factory=frozenset)
    auth_method: str = "api_key"
    user_id: uuid.UUID | None = None
    mfa_enabled: bool = False

    @property
    def is_service(self) -> bool:
        return self.auth_method == "service_token"

    def has_scope(self, scope: str) -> bool:
        return scope in self.scopes


SERVICE_PRINCIPAL = Principal(
    subject="service:nextjs-bff",
    role=Role.ADMIN,
    scopes=ALL_SCOPES,
    auth_method="service_token",
)


def hash_api_key(secret: str, pepper: str | None = None) -> str:
    material = f"{pepper or ''}{secret}".encode()
    return hashlib.sha256(material).hexdigest()


def generate_api_key(pepper: str | None = None) -> tuple[str, str, str]:
    """Return ``(full_key, prefix, hash)``. The full key is shown once.

    The secret is hex, not base64url: ``_`` is the field separator, so a secret
    containing one would make the key unparseable.
    """
    prefix = secrets.token_hex(4)
    secret = secrets.token_hex(24)
    full = f"{API_KEY_PREFIX}_{prefix}_{secret}"
    return full, prefix, hash_api_key(secret, pepper)


def _pepper(settings: Settings) -> str | None:
    if settings.api_key_pepper is None:
        return None
    return settings.api_key_pepper.get_secret_value() or None


def authenticate_token(session: Session, token: str, settings: Settings | None = None) -> Principal:
    settings = settings or get_settings()
    token = (token or "").strip()
    if not token:
        raise Unauthorized("Missing bearer token.")

    service_token = (
        settings.engine_token.get_secret_value() if settings.engine_token is not None else ""
    )
    if service_token and hmac.compare_digest(token, service_token):
        return SERVICE_PRINCIPAL

    parts = token.split("_", 2)
    if len(parts) != 3 or parts[0] != API_KEY_PREFIX or not parts[1] or not parts[2]:
        raise Unauthorized("Malformed API key.")

    _, prefix, secret = parts
    row = session.scalar(select(ApiKey).where(ApiKey.key_prefix == prefix))
    if row is None or row.revoked_at is not None:
        raise Unauthorized("Unknown or revoked API key.")

    if not hmac.compare_digest(row.key_hash, hash_api_key(secret, _pepper(settings))):
        raise Unauthorized("Invalid API key.")

    user = session.get(User, row.user_id)
    if user is None or not user.is_active:
        raise Unauthorized("The account for this API key is not active.")

    row.last_used_at = datetime.now(tz=UTC)

    return Principal(
        subject=user.email,
        role=parse_role(row.role),
        scopes=frozenset(row.scopes or []),
        auth_method="api_key",
        user_id=user.id,
        mfa_enabled=user.mfa_enabled,
    )
