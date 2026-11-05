"""RFC 6238 TOTP, implemented on the standard library.

Deliberately dependency-free: MFA is a security control, and a control that
depends on a third-party package's release cadence is a control that can be
removed by a supply-chain event. The algorithm is small enough to own.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
from datetime import UTC, datetime
from urllib.parse import quote

DEFAULT_STEP_SECONDS = 30
DEFAULT_DIGITS = 6


def generate_secret(byte_length: int = 20) -> str:
    """A base32 secret, unpadded, as authenticator apps expect."""
    return base64.b32encode(secrets.token_bytes(byte_length)).decode("ascii").rstrip("=")


def _decode_secret(secret: str) -> bytes:
    padding = "=" * (-len(secret) % 8)
    return base64.b32decode(secret.upper() + padding)


def _hotp(secret: str, counter: int, digits: int = DEFAULT_DIGITS) -> str:
    digest = hmac.new(_decode_secret(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    truncated = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(truncated % (10**digits)).zfill(digits)


def code_at(
    secret: str,
    at: datetime | None = None,
    *,
    step: int = DEFAULT_STEP_SECONDS,
    digits: int = DEFAULT_DIGITS,
) -> str:
    moment = at or datetime.now(tz=UTC)
    counter = int(moment.timestamp()) // step
    return _hotp(secret, counter, digits)


def verify(
    secret: str,
    code: str,
    at: datetime | None = None,
    *,
    step: int = DEFAULT_STEP_SECONDS,
    digits: int = DEFAULT_DIGITS,
    window: int = 1,
) -> bool:
    """Constant-time check allowing one step of clock drift either way."""
    candidate = (code or "").strip().replace(" ", "")
    if not candidate.isdigit() or len(candidate) != digits:
        return False

    moment = at or datetime.now(tz=UTC)
    counter = int(moment.timestamp()) // step

    matched = False
    for offset in range(-window, window + 1):
        expected = _hotp(secret, counter + offset, digits)
        # compare_digest on every candidate so timing does not leak the offset.
        matched |= hmac.compare_digest(expected, candidate)
    return matched


def provisioning_uri(secret: str, account: str, issuer: str = "Wands") -> str:
    label = quote(f"{issuer}:{account}")
    return (
        f"otpauth://totp/{label}?secret={secret}"
        f"&issuer={quote(issuer)}&algorithm=SHA1&digits={DEFAULT_DIGITS}"
        f"&period={DEFAULT_STEP_SECONDS}"
    )
