"""Encryption of credentials at rest.

Broker API keys are the highest-value asset in the system. They are stored as
Fernet ciphertext (AES-128-CBC + HMAC-SHA256) with a key that lives only in the
process environment, so a database dump or a stolen backup is not a stolen
trading account.
"""

from __future__ import annotations

import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from wands.config import get_settings
from wands.errors import EngineError


class SecretBoxError(EngineError):
    code = "engine_error"
    status_code = 500


class SecretBox:
    def __init__(self, key: str | None = None) -> None:
        raw = key or get_settings().require_encryption_key()
        try:
            self._fernet = Fernet(raw.encode() if isinstance(raw, str) else raw)
        except (ValueError, TypeError) as exc:
            raise SecretBoxError(
                "WANDS_ENCRYPTION_KEY is not a valid Fernet key. Generate one with "
                'python -c "from cryptography.fernet import Fernet; '
                'print(Fernet.generate_key().decode())"'
            ) from exc

    def encrypt(self, payload: dict[str, Any]) -> str:
        return self._fernet.encrypt(json.dumps(payload).encode()).decode()

    def decrypt(self, token: str) -> dict[str, Any]:
        try:
            return json.loads(self._fernet.decrypt(token.encode()).decode())
        except (InvalidToken, ValueError) as exc:
            raise SecretBoxError(
                "Stored credentials could not be decrypted. The encryption key has "
                "probably been rotated without re-encrypting the stored values."
            ) from exc


def key_hint(secret: str) -> str:
    """Only the last four characters are ever returned to a client."""
    return f"...{secret[-4:]}" if len(secret) >= 4 else "..."
