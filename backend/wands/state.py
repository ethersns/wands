"""Engine state and active risk policy accessors.

Both are singletons in the database. Reading them through one module means the
emergency-stop flag and the policy can never be read from a stale in-process
copy.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.db.models import EngineStateRow, RiskPolicyRow
from wands.risk.policy import DEFAULT_POLICY, RiskPolicy

STATE_ID = 1


def get_engine_state(session: Session) -> EngineStateRow:
    row = session.get(EngineStateRow, STATE_ID)
    if row is None:
        row = EngineStateRow(id=STATE_ID)
        session.add(row)
        session.flush()
    return row


def get_active_policy_row(session: Session) -> RiskPolicyRow:
    row = session.scalar(select(RiskPolicyRow).where(RiskPolicyRow.is_active.is_(True)).limit(1))
    if row is None:
        row = RiskPolicyRow(name="default", is_active=True, **DEFAULT_POLICY.to_row_kwargs())
        session.add(row)
        session.flush()
    return row


def get_policy(session: Session) -> RiskPolicy:
    return RiskPolicy.from_row(get_active_policy_row(session))
