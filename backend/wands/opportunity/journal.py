"""The paper-test journal and its outcome evaluation.

A recorded test is a hypothesis with its assumptions frozen at the moment it was
written down. Evaluation then walks the genuine candles that followed and reports
what the quoted price path did.

That is a price-path evaluation, not a simulated fill. It says the market printed
a price; it does not say an order would have received it. Costs are estimated
separately and subtracted, so the gross figure and the cost figure stay
distinguishable.

Rejected and never-triggered candidates are kept. Dropping them would leave only
the tests that happened to open, which is exactly the selection bias a journal
exists to prevent.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Sequence

from wands.schemas import Candle, MarketType

# Candidate lifecycle.
CANDIDATE_GENERATED = "candidate_generated"
CANDIDATE_WATCHED = "candidate_watched"
CANDIDATE_REJECTED = "candidate_rejected"

# Test lifecycle.
ENTRY_NOT_TRIGGERED = "entry_not_triggered"
TEST_ACTIVE = "test_active"
TEST_COMPLETED = "test_completed"
TEST_INVALIDATED = "test_invalidated"
TEST_EXPIRED = "test_expired"
INSUFFICIENT_DATA = "insufficient_data"

DECISIONS = (CANDIDATE_WATCHED, CANDIDATE_REJECTED)


@dataclass(frozen=True)
class PaperTest:
    """The assumptions frozen when the founder recorded the test."""

    symbol: str
    market_type: MarketType
    strategy_key: str
    strategy_version: int
    reference_price: Decimal
    invalidation_price: Decimal
    target_price: Decimal
    quantity: Decimal
    fee_bps: float
    slippage_bps: float
    opened_at: datetime
    deadline: datetime
    entry_price: Decimal | None = None


@dataclass(frozen=True)
class TestOutcome:
    status: str
    exit_reason: str
    entry_price: Decimal | None = None
    exit_price: Decimal | None = None
    exit_at: datetime | None = None
    holding_seconds: float | None = None
    gross_return: Decimal | None = None
    fees: Decimal | None = None
    slippage: Decimal | None = None
    net_return: Decimal | None = None
    drawdown: Decimal | None = None
    notes: tuple[str, ...] = ()

    @property
    def settled(self) -> bool:
        return self.status in (TEST_COMPLETED, TEST_INVALIDATED, TEST_EXPIRED)


def _at(candle: Candle) -> datetime:
    return datetime.fromtimestamp(candle.time, tz=UTC)


def evaluate_test(
    test: PaperTest, candles: Sequence[Candle]
) -> TestOutcome:
    """Walk the candles that followed the signal and report what happened.

    ``candles`` must be the completed candles strictly after the triggering
    candle, oldest first. The first one's open is the entry, because the rule
    enters on the next candle rather than on the close that triggered it.
    """
    if not candles:
        return TestOutcome(
            status=INSUFFICIENT_DATA,
            exit_reason="No candle has completed since the signal was recorded.",
        )

    entry = test.entry_price if test.entry_price is not None else candles[0].open
    if entry <= 0:
        return TestOutcome(
            status=INSUFFICIENT_DATA,
            exit_reason="The entry candle has no usable open price.",
        )

    worst = entry
    exit_price: Decimal | None = None
    exit_at: datetime | None = None
    status = TEST_ACTIVE
    reason = "The test is still open."
    notes: list[str] = []

    for candle in candles:
        moment = _at(candle)
        if moment > test.deadline:
            break
        worst = min(worst, candle.low)

        hit_stop = candle.low <= test.invalidation_price
        hit_target = candle.high >= test.target_price

        if hit_stop and hit_target:
            # Both levels sit inside one candle, so the order they were touched
            # in is unknowable from OHLC. The stop is assumed, which is the
            # conservative reading and is stated rather than hidden.
            exit_price = test.invalidation_price
            exit_at = moment
            status = TEST_INVALIDATED
            reason = (
                "The candle spanned both the target and the invalidation level, so "
                "the touch order is unknown. The invalidation level is assumed."
            )
            notes.append("Intrabar ambiguity resolved against the test.")
            break
        if hit_stop:
            exit_price = test.invalidation_price
            exit_at = moment
            status = TEST_INVALIDATED
            reason = "Price traded at or below the invalidation level."
            break
        if hit_target:
            exit_price = test.target_price
            exit_at = moment
            status = TEST_COMPLETED
            reason = "Price reached the target."
            break

    if status is TEST_ACTIVE:
        last = candles[-1]
        last_at = _at(last)
        if last_at >= test.deadline:
            exit_price = last.close
            exit_at = last_at
            status = TEST_EXPIRED
            reason = "The holding window ended before either level was reached."
        else:
            return TestOutcome(
                status=TEST_ACTIVE,
                exit_reason=reason,
                entry_price=entry,
                drawdown=(entry - worst) / entry,
                notes=tuple(notes),
            )

    assert exit_price is not None and exit_at is not None

    gross = (exit_price - entry) * test.quantity
    notional = entry * test.quantity
    fees = notional * Decimal(str(test.fee_bps)) / Decimal(10000) * 2
    slippage = notional * Decimal(str(test.slippage_bps)) / Decimal(10000) * 2

    return TestOutcome(
        status=status,
        exit_reason=reason,
        entry_price=entry,
        exit_price=exit_price,
        exit_at=exit_at,
        holding_seconds=(exit_at - test.opened_at).total_seconds(),
        gross_return=gross,
        fees=fees,
        slippage=slippage,
        net_return=gross - fees - slippage,
        drawdown=(entry - worst) / entry,
        notes=tuple(notes),
    )
