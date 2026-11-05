"""Decimal money helpers.

Every monetary value in the engine is a ``Decimal``. Floats are used only at the
JSON boundary, where the TypeScript contract declares ``number``. Doing the
arithmetic in ``float`` and rounding at the end is how a portfolio drifts by a
cent per trade and never reconciles.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

MONEY_QUANTUM = Decimal("0.00000001")
PERCENT_QUANTUM = Decimal("0.001")
ZERO = Decimal("0")
HUNDRED = Decimal("100")


def to_decimal(value: object, *, default: Decimal | None = None) -> Decimal | None:
    if value is None:
        return default
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return default


def money(value: object) -> Decimal:
    amount = to_decimal(value, default=ZERO) or ZERO
    return amount.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def percent(value: object) -> Decimal:
    amount = to_decimal(value, default=ZERO) or ZERO
    return amount.quantize(PERCENT_QUANTUM, rounding=ROUND_HALF_UP)


def safe_div(numerator: Decimal | None, denominator: Decimal | None) -> Decimal | None:
    if numerator is None or denominator is None or denominator == ZERO:
        return None
    return numerator / denominator


def pct_of(part: Decimal | None, whole: Decimal | None) -> Decimal | None:
    ratio = safe_div(part, whole)
    if ratio is None:
        return None
    return percent(ratio * HUNDRED)
