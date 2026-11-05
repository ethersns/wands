"""Foreign-exchange conversion from stored snapshots.

A rate is a fact with a timestamp, not a formula. This module therefore:

* stores every rate it is given, with the moment it was true;
* never inverts a pair at read time — ``USD/EUR`` is a different number from
  ``1 / (EUR/USD)`` once rounding is applied, and a portfolio that values the
  same position two ways is not auditable;
* reports a stale rate as stale, and refuses to hand a stale rate to the risk
  engine.

If no rate exists the answer is ``None``. A guessed FX rate silently changes
every position's value, which is worse than an unavailable figure.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.config import Settings, get_settings
from wands.db.models import FxRateRow
from wands.portfolio.money import ZERO, money


@dataclass(frozen=True)
class FxQuote:
    base: str
    quote: str
    rate: Decimal
    as_of: datetime
    age_seconds: float
    stale: bool
    source: str


class FxConverter:
    def __init__(
        self,
        session: Session,
        *,
        settings: Settings | None = None,
        clock=lambda: datetime.now(tz=UTC),
    ) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self._clock = clock

    def store(
        self,
        base: str,
        quote: str,
        rate: Decimal,
        *,
        as_of: datetime | None = None,
        source: str = "manual",
    ) -> FxRateRow:
        base = base.upper()
        quote = quote.upper()
        if base == quote:
            raise ValueError("An FX rate for a currency against itself is not stored.")
        if rate <= ZERO:
            raise ValueError("An FX rate must be positive.")

        moment = (as_of or self._clock()).astimezone(UTC)
        existing = self.session.scalar(
            select(FxRateRow)
            .where(
                FxRateRow.base_currency == base,
                FxRateRow.quote_currency == quote,
                FxRateRow.as_of == moment,
            )
            .limit(1)
        )
        if existing is not None:
            return existing

        row = FxRateRow(
            base_currency=base,
            quote_currency=quote,
            rate=rate,
            as_of=moment,
            source=source,
        )
        self.session.add(row)
        self.session.flush()
        return row

    def seed_overrides(self) -> int:
        """Persist ``WANDS_FX_RATE_OVERRIDES`` when the stored rate differs."""
        stored = 0
        for (base, quote), rate in self.settings.fx_overrides.items():
            latest = self.quote(base, quote)
            if latest is not None and latest.rate == rate:
                continue
            self.store(base, quote, rate, source="config")
            stored += 1
        return stored

    def quote(self, base: str, quote: str, *, at: datetime | None = None) -> FxQuote | None:
        base = base.upper()
        quote = quote.upper()
        moment = (at or self._clock()).astimezone(UTC)

        if base == quote:
            return FxQuote(
                base=base,
                quote=quote,
                rate=Decimal("1"),
                as_of=moment,
                age_seconds=0.0,
                stale=False,
                source="identity",
            )

        row = self.session.scalar(
            select(FxRateRow)
            .where(
                FxRateRow.base_currency == base,
                FxRateRow.quote_currency == quote,
                FxRateRow.as_of <= moment,
            )
            .order_by(FxRateRow.as_of.desc())
            .limit(1)
        )
        if row is None:
            return None

        as_of = row.as_of if row.as_of.tzinfo is not None else row.as_of.replace(tzinfo=UTC)
        age = max(0.0, (moment - as_of).total_seconds())
        return FxQuote(
            base=base,
            quote=quote,
            rate=Decimal(row.rate),
            as_of=as_of,
            age_seconds=age,
            stale=age > self.settings.fx_max_age_seconds,
            source=row.source,
        )

    def rate(self, base: str, quote: str, *, at: datetime | None = None) -> Decimal | None:
        found = self.quote(base, quote, at=at)
        return found.rate if found is not None else None

    def trusted_rate(
        self, base: str, quote: str, *, at: datetime | None = None
    ) -> Decimal | None:
        """A rate the risk engine may use: present and not stale."""
        found = self.quote(base, quote, at=at)
        if found is None or found.stale:
            return None
        return found.rate

    def convert(
        self,
        amount: Decimal | None,
        base: str,
        quote: str,
        *,
        at: datetime | None = None,
    ) -> Decimal | None:
        if amount is None:
            return None
        rate = self.rate(base, quote, at=at)
        if rate is None:
            return None
        return money(amount * rate)
