"""Idempotent startup seeding.

Runs on every boot. Everything here is an upsert, so restarting the engine never
duplicates a strategy or resets an operator's risk policy.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.db.models import StrategyRow, User, UserSettings
from wands.logging import get_logger
from wands.state import get_active_policy_row, get_engine_state
from wands.strategies.registry import BUILTIN_STRATEGIES

logger = get_logger(__name__)

SYSTEM_EMAIL = "system@wands.local"


def ensure_system_user(session: Session) -> User:
    """The account the service token acts as for per-user settings."""
    user = session.scalar(select(User).where(User.email == SYSTEM_EMAIL))
    if user is None:
        user = User(
            email=SYSTEM_EMAIL,
            display_name="Wands Operator",
            role="admin",
            is_active=True,
        )
        session.add(user)
        session.flush()
        session.add(
            UserSettings(
                user_id=user.id,
                base_currency="USD",
                theme="dark",
                notifications={
                    "tradeFills": True,
                    "riskBreaches": True,
                    "engineOffline": True,
                    "dailySummary": False,
                },
            )
        )
        session.flush()
    return user


def seed_strategies(session: Session) -> None:
    for definition in BUILTIN_STRATEGIES:
        row = session.scalar(select(StrategyRow).where(StrategyRow.slug == definition.slug))
        payload = {
            "name": definition.name,
            "description": definition.description,
            "category": str(definition.category),
            "version": definition.version,
            "supported_markets": [str(market) for market in definition.supported_markets],
            "deployment": str(definition.deployment),
            "config_schema": list(definition.parameters),
        }
        if row is None:
            session.add(StrategyRow(slug=definition.slug, **payload))
        else:
            for key, value in payload.items():
                setattr(row, key, value)
    session.flush()


def bootstrap(session: Session) -> None:
    get_engine_state(session)
    get_active_policy_row(session)
    seed_strategies(session)
    ensure_system_user(session)
    session.commit()
    logger.info("bootstrap complete", extra={"event": "bootstrap"})
