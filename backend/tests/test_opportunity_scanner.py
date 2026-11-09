"""Bounded work, restart/replay safety and conservative discovery filters."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import func, select

from wands.api.routes.opportunity import _store_report
from wands.config import Settings
from wands.db.models import OppCandidateRow, OppScanStateRow
from wands.errors import BadRequest
from wands.marketdata.base import ProviderRateLimited, ProviderUnavailable
from wands.marketdata.kraken import KrakenPublicProvider
from wands.marketdata.rate_limit import RetryPolicy
from wands.marketdata.service import MarketDataService
from wands.opportunity.scanner import ScanCoordinator
from wands.schemas import CandleInterval, CandleSeries, MarketType

from .test_opportunity import BASE, breakout_series

NOW = BASE + timedelta(minutes=101)


def asset(name="SOL", status="online", quote="ZUSD", **extra):
    return {
        "wsname": f"{name}/USD",
        "quote": quote,
        "aclass_base": "currency",
        "aclass_quote": "currency",
        "status": status,
        **extra,
    }


CATALOG = {
    "SOLUSD": asset(),
    "XXBTZUSD": asset("XBT"),
    "XDGUSD": asset("XDG"),
    "OLDUSD": asset("OLD", "cancel_only"),
    "EURPAIR": asset("NO", quote="ZEUR"),
    "USDTPAIR": asset("NO", quote="USDT"),
    "TOKENUSD": asset("TOKEN", aclass_base="tokenized_asset"),
}
TICKER = {"a": ["100.01"], "b": ["100"], "v": ["1", "2000"], "p": ["1", "100"]}


class Clock:
    now = NOW

    def __call__(self):
        return self.now

    def tick(self, seconds=3):
        self.now += timedelta(seconds=seconds)


class Provider(KrakenPublicProvider):
    def __init__(self, calls, *, catalog=None, failure=None):
        super().__init__()
        self.calls = calls
        self.catalog = catalog
        self.failure = failure

    def discover_usd_pairs(self):
        self.calls.append("catalog")
        return self.catalog or [{"symbol": "SOL/USD", "pair": "SOLUSD", "status": "online"}]

    def rank_usd_pairs(self, markets, *, limit, min_usd_volume, max_spread_pct):
        self.calls.append("rank")
        active = [market for market in markets if market["status"] == "online"]
        return active[:limit], len(active)

    def check_liquidity(self, *args, **kwargs):
        self.calls.append("ticker")
        if self.failure:
            raise self.failure
        return None


def source(session, calls, **kwargs):
    service = MarketDataService(
        session, settings=Settings(), providers={MarketType.CRYPTO: Provider(calls, **kwargs)}
    )

    def candles(symbol, interval, **kw):
        calls.append("candles")
        return CandleSeries(symbol=symbol, interval=interval, candles=breakout_series())

    service.scan_candles = candles
    return service


def step(session, clock, calls, state=None, **kwargs):
    request = {} if state is None else {"run_id": state["runId"], "cursor": state["cursor"]}
    result = ScanCoordinator(session, clock=clock).advance(
        service=source(session, calls, **kwargs), store_report=_store_report, **request
    )
    clock.tick()
    return result


def ready_crypto(session, clock, calls):
    state = step(session, clock, calls)
    for _ in range(4):
        state = step(session, clock, calls, state)
    return state


def test_market_snapshot_uses_one_bulk_ticker_and_preserves_missing_values():
    calls = []
    ticker = {
        "a": ["101"],
        "b": ["99"],
        "c": ["120"],
        "h": ["130", "120"],
        "l": ["80", "80"],
        "v": ["1", "2000"],
        "p": ["110", "100"],
        "o": "100",
    }

    def handle(request):
        calls.append(request)
        return httpx.Response(
            200,
            headers={"date": "Mon, 09 Nov 2026 15:00:00 GMT"},
            json={"error": [], "result": {"XBTUSD": ticker}},
        )

    provider = KrakenPublicProvider(client=httpx.Client(transport=httpx.MockTransport(handle)))
    snapshot = provider.market_snapshot(
        [
            {"symbol": "BTC/USD", "pair": "XBTUSD", "status": "online"},
            {"symbol": "MISSING/USD", "pair": "MISSINGUSD", "status": "online"},
        ]
    )

    bitcoin, missing = snapshot["markets"]
    assert len(calls) == 1
    assert snapshot["timestampSource"] == "provider"
    assert bitcoin["turnover24hUsd"] == "200000"
    assert bitcoin["dayChangePct"] == "20.0"
    assert bitcoin["range24hPct"] == str(Decimal("40") / Decimal("100") * Decimal("100"))
    assert bitcoin["spreadPct"] == "2.00"
    assert missing["tickerAvailable"] is False
    assert missing["turnover24hUsd"] is None
    assert missing["dayChangePct"] is None
    assert missing["warnings"]


def test_discovery_filters_quote_class_dark_pools_and_normalizes_aliases():
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"error": [], "result": {**CATALOG, "DARK.d": asset("DARK")}})

    provider = KrakenPublicProvider(client=httpx.Client(transport=httpx.MockTransport(handle)))
    result = provider.discover_usd_pairs()
    assert {item["symbol"] for item in result} == {"BTC/USD", "DOGE/USD", "SOL/USD", "OLD/USD"}
    assert next(item for item in result if item["symbol"] == "OLD/USD")["status"] == "cancel_only"
    assert len(calls) == 1


@pytest.mark.parametrize(
    "change,reason",
    [
        ({"v": ["1", "1"]}, "turnover"),
        ({"a": ["110"]}, "spread"),
        ({"p": ["1", "NaN"]}, "unavailable"),
        ({"b": ["0"]}, "unavailable"),
        ({"a": ["99"]}, "unavailable"),
        ({"v": []}, "unavailable"),
    ],
)
def test_liquidity_fails_closed(change, reason):
    provider = KrakenPublicProvider(
        client=httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200, json={"error": [], "result": {"SOLUSD": {**TICKER, **change}}}
                )
            )
        )
    )
    rejection = provider.check_liquidity(
        "SOLUSD", min_usd_volume=Decimal("100000"), max_spread_pct=Decimal("1")
    )
    assert reason in rejection.lower()


def test_liquidity_uses_rolling_volume_times_vwap_not_last_trade():
    provider = KrakenPublicProvider(
        client=httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200, json={"error": [], "result": {"SOLUSD": {**TICKER, "c": ["0.001"]}}}
                )
            )
        )
    )
    assert (
        provider.check_liquidity("SOLUSD", min_usd_volume=Decimal("100000"), max_spread_pct=Decimal("1"))
        is None
    )


def test_bulk_ticker_ranking_selects_highest_turnover_with_stable_ties():
    tickers = {
        "SOLUSD": TICKER,
        "XXBTZUSD": {**TICKER, "v": ["1", "2000"]},
        "XDGUSD": TICKER,
        "OLDUSD": {**TICKER, "v": ["1", "9000"]},
    }
    requests = []
    provider = KrakenPublicProvider(
        client=httpx.Client(
            transport=httpx.MockTransport(
                lambda request: (
                    requests.append(request)
                    or httpx.Response(200, json={"error": [], "result": tickers})
                )
            )
        )
    )

    selected, eligible = provider.rank_usd_pairs(
        [
            {"symbol": "SOL/USD", "pair": "SOLUSD", "status": "online"},
            {"symbol": "BTC/USD", "pair": "XXBTZUSD", "status": "online"},
            {"symbol": "DOGE/USD", "pair": "XDGUSD", "status": "online"},
        ],
        limit=1,
        min_usd_volume=Decimal("100000"),
        max_spread_pct=Decimal("1"),
    )

    assert eligible == 3
    assert [market["symbol"] for market in selected] == ["BTC/USD"]
    assert len(requests) == 1
    assert "pair=" not in str(requests[0].url)


def test_kraken_http_200_throttle_is_retryable():
    provider = KrakenPublicProvider(
        client=httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"error": ["EAPI:Rate limit exceeded"]})
            )
        ),
        sleep=lambda _: None,
    )
    with pytest.raises(ProviderRateLimited):
        provider.discover_usd_pairs()


def test_hundreds_of_pairs_do_not_fan_out(session):
    clock, calls = Clock(), []
    catalog = [{"symbol": f"ASSET{i}/USD", "pair": f"ASSET{i}USD", "status": "online"} for i in range(800)]
    state = step(session, clock, calls, catalog=catalog)
    assert state["total"] == 44
    assert state["checked"] == 0
    assert state["activeUsdPairs"] == 800
    assert calls == ["catalog", "rank"]
    assert "40 of 800 online Kraken USD spot pairs" in state["notes"][0]
    assert "760 online pairs were not scanned" in state["notes"][0]
    assert "markets" not in state
    assert ScanCoordinator(session, clock=clock).status()["runId"] == state["runId"]


def test_restart_resume_separate_requests_and_duplicate_cursor_are_idempotent(session):
    clock, calls = Clock(), []
    state = ready_crypto(session, clock, calls)
    assert state["checked"] == 4
    assert calls == ["catalog", "rank"]
    before = dict(state)
    state = step(session, clock, calls, state)
    assert calls == ["catalog", "rank", "ticker"]
    assert state["checked"] == 4
    replay = ScanCoordinator(session, clock=clock).advance(
        service=source(session, calls),
        store_report=_store_report,
        run_id=before["runId"],
        cursor=before["cursor"],
    )
    assert replay["cursor"] == state["cursor"]
    assert calls == ["catalog", "rank", "ticker"]
    clock.tick()
    before = dict(state)
    state = step(session, clock, calls, state)
    assert state["status"] == "complete"
    assert state["pairsChecked"] == 1
    assert state["qualified"] == 1
    assert calls == ["catalog", "rank", "ticker", "candles"]
    stored = session.scalar(select(OppCandidateRow))
    assert stored.symbol == "SOL/USD"
    assert state["candidates"] == [
        {"id": str(stored.id), "symbol": stored.symbol, "observedAt": stored.observed_at.isoformat()}
    ]
    replay = ScanCoordinator(session, clock=clock).advance(
        service=source(session, calls),
        store_report=_store_report,
        run_id=before["runId"],
        cursor=before["cursor"],
    )
    assert replay["status"] == "complete"
    assert session.scalar(select(func.count()).select_from(OppCandidateRow)) == 1


def test_explicit_new_bounded_scan_guards_checkpoint_and_keeps_candidates(session):
    clock, calls = Clock(), []
    state = ready_crypto(session, clock, calls)
    state = step(session, clock, calls, state)  # Fresh liquidity check.
    state = step(session, clock, calls, state)  # Store one qualified candidate.
    assert state["status"] == "complete"
    assert state["qualified"] == 1
    candidate_count = session.scalar(select(func.count()).select_from(OppCandidateRow))

    catalog = [
        {"symbol": f"ASSET{i}/USD", "pair": f"ASSET{i}USD", "status": "online"}
        for i in range(50)
    ]
    state = ScanCoordinator(session, clock=clock).advance(
        service=source(session, calls, catalog=catalog), store_report=_store_report, restart=True
    )
    assert state["status"] == "scanning"
    assert state["total"] == 44
    clock.tick(3)
    with pytest.raises(BadRequest):
        ScanCoordinator(session, clock=clock).advance(
            service=source(session, calls, catalog=catalog),
            store_report=_store_report,
            restart=True,
            replace_run_id=state["runId"],
            replace_cursor=state["cursor"] + 1,
        )
    current = ScanCoordinator(session, clock=clock).status()
    assert current["runId"] == state["runId"]
    assert current["cursor"] == state["cursor"]

    clock.tick(3)
    restarted = ScanCoordinator(session, clock=clock).advance(
        service=source(session, calls, catalog=catalog),
        store_report=_store_report,
        restart=True,
        replace_run_id=current["runId"],
        replace_cursor=current["cursor"],
    )
    assert restarted["runId"] != current["runId"]
    assert restarted["replacedRun"]["runId"] == current["runId"]
    assert session.scalar(select(func.count()).select_from(OppCandidateRow)) == candidate_count


def test_rate_limit_backoff_retains_market_and_blocks_early_requests(session):
    clock, calls = Clock(), []
    state = ready_crypto(session, clock, calls)
    state = step(
        session, clock, calls, state, failure=ProviderRateLimited("slow down", retry_after_seconds=45)
    )
    assert state["status"] == "paused"
    assert state["checked"] == 4
    previous_calls = list(calls)
    step(session, clock, calls, state)
    assert calls == previous_calls
    clock.tick(60)
    state = step(session, clock, calls, state)
    assert state["checked"] == 4  # Liquidity is rechecked, then OHLC gets its own request.
    state = step(session, clock, calls, state)
    assert state["status"] == "complete"


def test_inactive_and_illiquid_pairs_never_request_candles(session):
    clock, calls = Clock(), []
    state = step(
        session, clock, calls, catalog=[{"symbol": "OLD/USD", "pair": "OLDUSD", "status": "post_only"}]
    )
    for _ in range(5):
        state = step(session, clock, calls, state)
    assert state["status"] == "complete"
    assert any("Inactive" in item["reason"] for item in state["skipped"])
    assert calls == ["catalog", "rank"]


def test_stale_breakout_is_not_stored_as_opportunity(session):
    clock, calls = Clock(), []
    state = ready_crypto(session, clock, calls)
    clock.tick(3600)
    state = step(session, clock, calls, state)  # Refresh catalogue after a long pause.
    state = step(session, clock, calls, state)
    state = step(session, clock, calls, state)
    assert state["qualified"] == 0
    assert "Stale" in state["skipped"][-1]["reason"]
    assert session.scalar(select(func.count()).select_from(OppCandidateRow)) == 0


def test_failed_candidate_commit_does_not_advance_checkpoint(session):
    clock, calls = Clock(), []
    state = ready_crypto(session, clock, calls)
    state = step(session, clock, calls, state)
    cursor = state["cursor"]

    def fail(db, report):
        _store_report(db, report)
        raise RuntimeError("interrupted before checkpoint")

    with pytest.raises(RuntimeError):
        ScanCoordinator(session, clock=clock).advance(
            service=source(session, calls), store_report=fail, run_id=state["runId"], cursor=cursor
        )
    assert session.scalar(select(func.count()).select_from(OppCandidateRow)) == 0
    assert ScanCoordinator(session, clock=clock).status()["cursor"] == cursor
    clock.tick()
    assert step(session, clock, calls, state)["qualified"] == 1


def test_live_lease_blocks_overlap_expired_lease_can_resume(session):
    clock, calls = Clock(), []
    state = step(session, clock, calls)
    row = session.get(OppScanStateRow, 1)
    row.lease_owner = "other-process"
    row.lease_expires_at = clock() + timedelta(seconds=30)
    session.commit()
    result = step(session, clock, calls, state)
    assert result["busy"]
    assert calls == ["catalog", "rank"]
    clock.tick(31)
    assert step(session, clock, calls, state)["checked"] == 1


def test_replaced_run_and_interval_change_are_refused(session):
    clock, calls = Clock(), []
    state = step(session, clock, calls)
    for request in (
        {"run_id": "old", "cursor": 0},
        {"run_id": state["runId"], "cursor": state["cursor"], "interval": CandleInterval.H1},
    ):
        with pytest.raises(BadRequest):
            ScanCoordinator(session, clock=clock).advance(
                service=source(session, calls), store_report=_store_report, **request
            )
        clock.tick()


def test_existing_stocks_still_use_the_rule_and_whole_share_risk_limit(session):
    from types import SimpleNamespace

    clock, calls = Clock(), []
    state = step(session, clock, calls)
    service = source(session, calls)
    service.providers[MarketType.STOCKS] = SimpleNamespace(
        name="alpaca", timeout=3, is_configured=lambda: True, _client=None
    )
    state = ScanCoordinator(session, clock=clock).advance(
        service=service, store_report=_store_report, run_id=state["runId"], cursor=state["cursor"]
    )
    assert state["checked"] == 1
    assert state["pairsChecked"] == 0
    candidate = session.scalar(select(OppCandidateRow))
    assert candidate.symbol == "SPY"
    assert candidate.quantity is None
    assert "exposure ceiling" in candidate.rejected_reason


def test_illiquid_market_never_loads_candles(session):
    clock, calls = Clock(), []
    state = ready_crypto(session, clock, calls)
    service = source(session, calls)
    service.providers[MarketType.CRYPTO].check_liquidity = lambda *args, **kwargs: "Insufficient liquidity."
    state = ScanCoordinator(session, clock=clock).advance(
        service=service, store_report=_store_report, run_id=state["runId"], cursor=state["cursor"]
    )
    assert state["status"] == "complete"
    assert "candles" not in calls
    assert "liquidity" in state["skipped"][-1]["reason"]


def test_expired_worker_cannot_commit_candidates_or_progress(session):
    clock, calls = Clock(), []
    state = ready_crypto(session, clock, calls)
    state = step(session, clock, calls, state)
    cursor = state["cursor"]

    def expired_worker(db, report):
        stored = _store_report(db, report)
        clock.tick(31)
        return stored

    with pytest.raises(BadRequest):
        ScanCoordinator(session, clock=clock).advance(
            service=source(session, calls), store_report=expired_worker, run_id=state["runId"], cursor=cursor
        )
    assert session.scalar(select(func.count()).select_from(OppCandidateRow)) == 0
    assert ScanCoordinator(session, clock=clock).status()["cursor"] == cursor


def test_delisted_market_after_pause_is_not_scanned(session):
    clock, calls = Clock(), []
    state = ready_crypto(session, clock, calls)
    clock.tick(301)
    state = step(
        session,
        clock,
        calls,
        state,
        catalog=[{"symbol": "SOL/USD", "pair": "SOLUSD", "status": "cancel_only"}],
    )
    state = step(session, clock, calls, state)
    assert state["status"] == "complete"
    assert "Inactive" in state["skipped"][-1]["reason"]
    assert calls == ["catalog", "rank", "catalog"]


def test_upstream_retry_after_is_preserved():
    provider = KrakenPublicProvider(
        client=httpx.Client(
            transport=httpx.MockTransport(lambda request: httpx.Response(429, headers={"Retry-After": "120"}))
        ),
        retry_policy=RetryPolicy(max_attempts=1),
    )
    with pytest.raises(ProviderRateLimited) as error:
        provider.discover_usd_pairs()
    assert error.value.retry_after_seconds == 120


def test_repeated_transport_failure_records_rejection_not_quiet_zero(session):
    clock, calls = Clock(), []
    state = ready_crypto(session, clock, calls)
    for _ in range(3):
        state = step(session, clock, calls, state, failure=ProviderUnavailable("provider offline"))
        clock.tick(70)
    assert state["status"] == "complete"
    assert "provider offline" in state["skipped"][-1]["reason"]
    assert state["qualified"] == 0
