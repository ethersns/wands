"""Market session awareness.

Crypto trades continuously; US equities do not. The risk engine already blocks
an order when ``market_open`` is unknown, so this module must answer with a real
session rather than a guess.

Only the regular session counts as open for order submission. Pre- and
post-market are reported as ``pre``/``post`` and are *not* tradeable by default:
thin books and wide spreads are exactly where a paper strategy learns the wrong
lesson.

The holiday list is maintained data, not a calculation. It is deliberately
explicit so a wrong date is a visible diff rather than a silent algorithm.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

from wands.schemas import MarketSessionState, MarketType

NEW_YORK = ZoneInfo("America/New_York")

US_MARKET_HOLIDAYS: frozenset[date] = frozenset(
    {
        # 2025
        date(2025, 1, 1),
        date(2025, 1, 9),  # national day of mourning
        date(2025, 1, 20),
        date(2025, 2, 17),
        date(2025, 4, 18),
        date(2025, 5, 26),
        date(2025, 6, 19),
        date(2025, 7, 4),
        date(2025, 9, 1),
        date(2025, 11, 27),
        date(2025, 12, 25),
        # 2026
        date(2026, 1, 1),
        date(2026, 1, 19),
        date(2026, 2, 16),
        date(2026, 4, 3),
        date(2026, 5, 25),
        date(2026, 6, 19),
        date(2026, 7, 3),
        date(2026, 9, 7),
        date(2026, 11, 26),
        date(2026, 12, 25),
        # 2027
        date(2027, 1, 1),
        date(2027, 1, 18),
        date(2027, 2, 15),
        date(2027, 3, 26),
        date(2027, 5, 31),
        date(2027, 6, 18),
        date(2027, 7, 5),
        date(2027, 9, 6),
        date(2027, 11, 25),
        date(2027, 12, 24),
    }
)

# Half days: the regular session closes at 13:00 New York time.
US_EARLY_CLOSES: frozenset[date] = frozenset(
    {
        date(2025, 7, 3),
        date(2025, 11, 28),
        date(2025, 12, 24),
        date(2026, 11, 27),
        date(2026, 12, 24),
        date(2027, 11, 26),
    }
)

REGULAR_OPEN = time(9, 30)
REGULAR_CLOSE = time(16, 0)
EARLY_CLOSE = time(13, 0)
PRE_OPEN = time(4, 0)
POST_CLOSE = time(20, 0)


@dataclass(frozen=True)
class SessionWindow:
    state: MarketSessionState
    is_open: bool
    next_change: datetime | None
    detail: str


class MarketCalendar(Protocol):
    def session(self, at: datetime) -> SessionWindow: ...


class CryptoCalendar:
    """Crypto never closes, so the session is always ``always``."""

    def session(self, at: datetime) -> SessionWindow:
        return SessionWindow(
            state=MarketSessionState.ALWAYS,
            is_open=True,
            next_change=None,
            detail="Crypto trades continuously.",
        )


class UsEquityCalendar:
    def session(self, at: datetime) -> SessionWindow:
        local = at.astimezone(NEW_YORK)
        today = local.date()
        clock = local.time()

        if today.weekday() >= 5:
            return SessionWindow(
                state=MarketSessionState.CLOSED,
                is_open=False,
                next_change=self._next_open(local),
                detail="US equities are closed at the weekend.",
            )
        if today in US_MARKET_HOLIDAYS:
            return SessionWindow(
                state=MarketSessionState.CLOSED,
                is_open=False,
                next_change=self._next_open(local),
                detail=f"US equities are closed for the {today.isoformat()} market holiday.",
            )

        close = EARLY_CLOSE if today in US_EARLY_CLOSES else REGULAR_CLOSE

        if PRE_OPEN <= clock < REGULAR_OPEN:
            return SessionWindow(
                state=MarketSessionState.PRE,
                is_open=False,
                next_change=datetime.combine(today, REGULAR_OPEN, tzinfo=NEW_YORK),
                detail="Pre-market session. Not tradeable by default.",
            )
        if REGULAR_OPEN <= clock < close:
            return SessionWindow(
                state=MarketSessionState.OPEN,
                is_open=True,
                next_change=datetime.combine(today, close, tzinfo=NEW_YORK),
                detail="Regular session.",
            )
        if close <= clock < POST_CLOSE:
            return SessionWindow(
                state=MarketSessionState.POST,
                is_open=False,
                next_change=self._next_open(local),
                detail="Post-market session. Not tradeable by default.",
            )
        return SessionWindow(
            state=MarketSessionState.CLOSED,
            is_open=False,
            next_change=self._next_open(local),
            detail="Outside US equity trading hours.",
        )

    def _next_open(self, local: datetime) -> datetime | None:
        candidate = local.date() + timedelta(days=1)
        for _ in range(10):
            if candidate.weekday() < 5 and candidate not in US_MARKET_HOLIDAYS:
                return datetime.combine(candidate, REGULAR_OPEN, tzinfo=NEW_YORK)
            candidate += timedelta(days=1)
        return None


CRYPTO_CALENDAR = CryptoCalendar()
US_EQUITY_CALENDAR = UsEquityCalendar()


def calendar_for(market_type: MarketType | str) -> MarketCalendar:
    if MarketType(market_type) is MarketType.CRYPTO:
        return CRYPTO_CALENDAR
    return US_EQUITY_CALENDAR


def session_for(market_type: MarketType | str, at: datetime) -> SessionWindow:
    return calendar_for(market_type).session(at)
