"""TOTP correctness against the RFC 6238 test vectors."""

from __future__ import annotations

from datetime import UTC, datetime

from wands.security.totp import code_at, generate_secret, provisioning_uri, verify

# RFC 6238 Appendix B, SHA-1, 8 digits, secret "12345678901234567890".
RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"


def test_rfc6238_vectors():
    vectors = {
        59: "94287082",
        1111111109: "07081804",
        1111111111: "14050471",
        1234567890: "89005924",
        2000000000: "69279037",
    }
    for timestamp, expected in vectors.items():
        moment = datetime.fromtimestamp(timestamp, tz=UTC)
        assert code_at(RFC_SECRET, moment, digits=8) == expected


def test_verify_accepts_the_current_code():
    secret = generate_secret()
    assert verify(secret, code_at(secret))


def test_verify_rejects_a_wrong_code():
    secret = generate_secret()
    assert not verify(secret, "000000")


def test_verify_rejects_malformed_input():
    secret = generate_secret()
    assert not verify(secret, "")
    assert not verify(secret, "abcdef")
    assert not verify(secret, "12345")


def test_verify_tolerates_one_step_of_drift():
    secret = generate_secret()
    moment = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
    previous = code_at(secret, datetime.fromtimestamp(moment.timestamp() - 30, tz=UTC))
    assert verify(secret, previous, moment)


def test_provisioning_uri_is_well_formed():
    uri = provisioning_uri("ABCDEF", "operator@wands.local")
    assert uri.startswith("otpauth://totp/")
    assert "secret=ABCDEF" in uri
    assert "issuer=Wands" in uri
