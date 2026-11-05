"""Background market-data refresh.

A single daemon thread, one database session per cycle, and no shared mutable
state beyond the stop event. If a cycle fails the thread logs and waits for the
next interval rather than exiting: a market-data outage must not take the engine
down, and a restart must not be required to recover.

The worker is deliberately not started in tests or when
``WANDS_MARKET_DATA_WORKER_ENABLED`` is false.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from contextlib import AbstractContextManager

from sqlalchemy.orm import Session

from wands.db.session import session_scope
from wands.logging import get_logger
from wands.marketdata.service import MarketDataService
from wands.schemas import CandleInterval

logger = get_logger(__name__)

SessionFactory = Callable[[], AbstractContextManager[Session]]


class MarketDataWorker:
    def __init__(
        self,
        *,
        interval_seconds: int = 30,
        watchlist: list[str] | None = None,
        candle_interval: CandleInterval = CandleInterval.H1,
        candle_limit: int = 200,
        session_factory: SessionFactory = session_scope,
        service_factory: Callable[[Session], MarketDataService] = MarketDataService,
    ) -> None:
        self.interval_seconds = max(5, interval_seconds)
        self.watchlist = watchlist
        self.candle_interval = candle_interval
        self.candle_limit = candle_limit
        self._session_factory = session_factory
        self._service_factory = service_factory
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, name="wands-market-data", daemon=True
        )
        self._thread.start()
        logger.info(
            "market data worker started",
            extra={"event": "marketdata.worker.start", "context": {"interval": self.interval_seconds}},
        )

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=timeout)
        self._thread = None

    def run_once(self) -> int:
        """Refresh one cycle. Returns the number of quotes obtained."""
        with self._session_factory() as session:
            service = self._service_factory(session)
            views = service.refresh_watchlist(self.watchlist)
            for view in views:
                service.refresh_candles(
                    view.symbol,
                    self.candle_interval,
                    market_type=view.market_type,
                    limit=self.candle_limit,
                )
            return len(views)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.run_once()
            except Exception as exc:  # noqa: BLE001 - the worker must survive a bad cycle
                logger.warning(
                    "market data cycle failed",
                    extra={
                        "event": "marketdata.worker.error",
                        "context": {"error": type(exc).__name__, "detail": str(exc)},
                    },
                )
            self._stop.wait(self.interval_seconds)
