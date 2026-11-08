"""The Opportunity Desk watchlist and the sessions it may trade in.

The list is deliberately small. A handful of liquid instruments is enough to
find out whether a rule is worth looking at, and it keeps the data cost bounded.
Full-market scanning is out of scope.

Sessions matter because a four-hour holding window means something different on
a venue that closes than on one that never does. A stock test that would run
past the close is capped at the close and reported as expiring, rather than
being carried into the next session as though the market had stayed open.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from wands.schemas import MarketType

NEW_YORK = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")

# The regular US equity session. Pre- and post-market are excluded: the spread
# and the volume there are not what the rule was written against.
STOCK_OPEN = time(9, 30)
STOCK_CLOSE = time(16, 0)


@dataclass(frozen=True)
class WatchlistEntry:
    symbol: str
    market_type: MarketType
    label: str

    @property
    def is_crypto(self) -> bool:
        return self.market_type is MarketType.CRYPTO


DEFAULT_WATCHLIST: tuple[WatchlistEntry, ...] = (
    WatchlistEntry("SPY", MarketType.STOCKS, "S&P 500 ETF"),
    WatchlistEntry("QQQ", MarketType.STOCKS, "Nasdaq 100 ETF"),
    WatchlistEntry("AAPL", MarketType.STOCKS, "Apple"),
    WatchlistEntry("MSFT", MarketType.STOCKS, "Microsoft"),
    WatchlistEntry("BTC/USD", MarketType.CRYPTO, "Bitcoin"),
    WatchlistEntry("ETH/USD", MarketType.CRYPTO, "Ethereum"),
)


def entry_for(symbol: str, watchlist: tuple[WatchlistEntry, ...] = DEFAULT_WATCHLIST) -> WatchlistEntry | None:
    wanted = (symbol or "").strip().upper()
    for entry in watchlist:
        if entry.symbol.upper() == wanted:
            return entry
    return None


def in_session(entry: WatchlistEntry, moment: datetime) -> bool:
    """Whether the venue is open at ``moment``.

    Crypto has no session, so it is always open. A stock is open only inside the
    regular New York session on a weekday.
    """
    if entry.is_crypto:
        return True
    local = moment.astimezone(NEW_YORK)
    if local.weekday() >= 5:
        return False
    return STOCK_OPEN <= local.time() < STOCK_CLOSE


def session_close(entry: WatchlistEntry, moment: datetime) -> datetime | None:
    """When the current session ends, or ``None`` when there is no boundary.

    ``None`` means "no cap applies": either the venue never closes, or it is
    already shut. Callers that need to distinguish the two should check
    :func:`in_session` first.
    """
    if entry.is_crypto:
        return None
    local = moment.astimezone(NEW_YORK)
    if local.weekday() >= 5:
        return None
    close = local.replace(
        hour=STOCK_CLOSE.hour, minute=STOCK_CLOSE.minute, second=0, microsecond=0
    )
    if local >= close:
        return None
    return close.astimezone(UTC)


def holding_deadline(
    entry: WatchlistEntry, opened_at: datetime, max_holding_hours: int
) -> datetime:
    """The moment a test must be closed, capped at the session close.

    A four-hour stock test opened at 14:00 New York expires at 16:00, not at
    18:00, because the venue is shut in between and the rule was never
    evaluated against an overnight gap.
    """
    deadline = opened_at + timedelta(hours=max_holding_hours)
    close = session_close(entry, opened_at)
    if close is not None and close < deadline:
        return close
    return deadline
