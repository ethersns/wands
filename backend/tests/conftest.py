"""Test fixtures.

The environment is configured at import time, before any ``wands`` module is
imported, because settings are cached and the engine is built from them. Tests
run against a throwaway SQLite file; production refuses SQLite.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

_TMP = Path(tempfile.mkdtemp(prefix="wands-tests-"))
_DB = _TMP / "wands.db"

SERVICE_TOKEN = "service-token-for-tests"
PEPPER = "test-pepper"

os.environ["WANDS_ENVIRONMENT"] = "test"
os.environ["WANDS_DATABASE_URL"] = f"sqlite:///{_DB}"
os.environ["WANDS_ENGINE_TOKEN"] = SERVICE_TOKEN
os.environ["WANDS_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
os.environ["WANDS_API_KEY_PEPPER"] = PEPPER
os.environ["WANDS_TRADING_MODE"] = "paper"
os.environ["WANDS_LIVE_TRADING_ENABLED"] = "false"
os.environ["WANDS_LOG_LEVEL"] = "WARNING"
# No test may depend on a live venue. Phase 3 tests inject deterministic mock
# providers explicitly.
os.environ["WANDS_MARKET_DATA_ENABLED"] = "false"
os.environ["WANDS_MARKET_DATA_WORKER_ENABLED"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from wands.bootstrap import bootstrap  # noqa: E402
from wands.config import get_settings  # noqa: E402
from wands.db.base import Base  # noqa: E402
from wands.db.models import ApiKey, ConnectionRow, User  # noqa: E402
from wands.db.session import get_engine, reset_engine, session_scope  # noqa: E402
from wands.main import create_app  # noqa: E402
from wands.security.auth import ALL_SCOPES, generate_api_key  # noqa: E402
from wands.security.secrets import SecretBox  # noqa: E402

AUTH = {"authorization": f"Bearer {SERVICE_TOKEN}"}


@pytest.fixture(autouse=True)
def fresh_database():
    reset_engine()
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with session_scope() as session:
        bootstrap(session)
    yield
    reset_engine()


@pytest.fixture()
def client() -> TestClient:
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture()
def session():
    with session_scope() as db_session:
        yield db_session


def make_api_key(role: str = "viewer", *, mfa: bool = False) -> tuple[str, User, str | None]:
    """Create a user with an API key. Returns (full_key, user, totp_secret)."""
    from wands.security.totp import generate_secret

    secret = generate_secret() if mfa else None
    with session_scope() as session:
        user = User(
            email=f"{role}-{os.urandom(3).hex()}@test.local",
            display_name=role.title(),
            role=role,
            mfa_enabled=mfa,
            is_active=True,
        )
        session.add(user)
        session.flush()

        if secret is not None:
            user.mfa_secret_encrypted = SecretBox().encrypt({"secret": secret})

        full, prefix, hashed = generate_api_key(PEPPER)
        session.add(
            ApiKey(
                user_id=user.id,
                name="test key",
                key_prefix=prefix,
                key_hash=hashed,
                role=role,
                scopes=sorted(ALL_SCOPES),
            )
        )
        session.flush()
        session.refresh(user)
        return full, user, secret


def make_connection(*, mode: str = "paper", provider: str = "kraken") -> str:
    with session_scope() as session:
        row = ConnectionRow(
            provider=provider,
            label="Test account",
            market_type="crypto" if provider == "kraken" else "stocks",
            status="connected",
            access="trading",
            mode=mode,
            key_hint="...abcd",
            permissions=["read", "trade"],
        )
        session.add(row)
        session.flush()
        return str(row.id)


def settings():
    return get_settings()


def paper_settings(**overrides):
    from wands.config import Settings

    base = {
        "database_url": "sqlite://",
        "live_trading_enabled": False,
        "max_account_state_age_seconds": 300,
        "max_spread_pct": 1.0,
    }
    base.update(overrides)
    return Settings(**base)


def good_context(**overrides):
    """A context in which every risk check passes.

    Tests then break exactly one field, so a failure names the rule that fired
    instead of a cascade of unrelated violations.
    """
    from decimal import Decimal

    from wands.risk.engine import RiskContext

    base = {
        "portfolio_equity": Decimal("10000"),
        "total_exposure": Decimal("1000"),
        "position_market_value": Decimal("0"),
        "crypto_exposure": Decimal("1000"),
        "stocks_exposure": Decimal("0"),
        "day_pnl_pct": Decimal("0"),
        "drawdown_pct": Decimal("0"),
        "quote_age_seconds": 1.0,
        "spread_pct": Decimal("0.1"),
        "buying_power": Decimal("10000"),
        "account_state_age_seconds": 10.0,
        "market_open": True,
        "reference_price": Decimal("100"),
        "stop_distance_pct": Decimal("2"),
        "recent_client_order_ids": frozenset(),
    }
    base.update(overrides)
    return RiskContext(**base)
