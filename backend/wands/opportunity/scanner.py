"""Request-bounded scans with an atomic candidate/checkpoint commit.

The singleton lease is cross-process, not a module-global cooldown. A response
lost after commit can be retried with the same run/cursor without writing again.
No task survives in a request thread: a browser explicitly advances each batch.
"""

from __future__ import annotations

import copy
import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from wands.db.models import OppScanStateRow
from wands.errors import BadRequest
from wands.marketdata.base import (
    ProviderDataError,
    ProviderNotConfigured,
    ProviderRateLimited,
    ProviderUnavailable,
)
from wands.marketdata.kraken import KrakenPublicProvider
from wands.marketdata.rate_limit import RetryPolicy, TokenBucket
from wands.marketdata.service import MarketDataService
from wands.opportunity.candidates import OpportunityDesk
from wands.opportunity.watchlist import DEFAULT_WATCHLIST, WatchlistEntry, in_session
from wands.schemas import CandleInterval, MarketType

MIN_USD_VOLUME = Decimal("100000")
MAX_ACTIVE_USD_PAIRS = 40
CATALOG_TTL_SECONDS = 300
BATCH_DELAY_SECONDS = 2
LEASE_SECONDS = 30
REQUEST_TIMEOUT_SECONDS = 3.0
MAX_FAILURES = 3


class ScanCoordinator:
    def __init__(self, session: Session, *, clock=lambda: datetime.now(UTC)):
        self.session = session
        self.clock = clock
        self.request_gap = BATCH_DELAY_SECONDS

    def status(self) -> dict[str, Any] | None:
        row = self.session.get(OppScanStateRow, 1, populate_existing=True)
        if row is None or not row.state:
            return None
        result = copy.deepcopy(row.state)
        result.pop("markets", None)
        result.pop("catalog", None)
        result["nextBatchAt"] = row.next_batch_at.isoformat() if row.next_batch_at else None
        result["busy"] = bool(row.lease_expires_at and row.lease_expires_at > self.clock())
        return result

    def _ensure_row(self) -> None:
        if self.session.get(OppScanStateRow, 1) is None:
            try:
                with self.session.begin_nested():
                    self.session.add(OppScanStateRow(id=1, state={}))
                    self.session.flush()
            except IntegrityError:
                pass  # Another process initialised the singleton.
        self.session.commit()

    def advance(
        self,
        *,
        service: MarketDataService,
        store_report,
        interval=CandleInterval.M5,
        run_id: str | None = None,
        cursor: int | None = None,
        restart: bool = False,
    ) -> dict[str, Any] | None:
        self._ensure_row()
        now = self.clock()
        owner = str(uuid.uuid4())
        claimed = self.session.execute(
            update(OppScanStateRow)
            .where(
                OppScanStateRow.id == 1,
                (OppScanStateRow.lease_expires_at.is_(None)) | (OppScanStateRow.lease_expires_at <= now),
                (OppScanStateRow.next_batch_at.is_(None)) | (OppScanStateRow.next_batch_at <= now),
            )
            .values(lease_owner=owner, lease_expires_at=now + timedelta(seconds=LEASE_SECONDS))
        ).rowcount
        self.session.commit()
        if not claimed:
            return self.status()
        row = self.session.get(OppScanStateRow, 1, populate_existing=True)
        state = copy.deepcopy(row.state)
        catalog_request = False
        try:
            if run_id is not None:
                if not state or run_id != state["runId"]:
                    raise BadRequest("This scan was replaced. Read its current status before resuming.")
                if cursor is None:
                    raise BadRequest("A resume request requires the acknowledged cursor.")
                if interval != state["interval"]:
                    raise BadRequest("A resumed scan must keep its original candle interval.")
                if cursor != state["cursor"] or state["status"] == "complete":
                    return self._finish(owner, state, delay=0, advance=False)
            elif state and (state["status"] != "complete" or not restart):
                return self._finish(owner, state, delay=0, advance=False)
            else:
                state = {
                    "runId": str(uuid.uuid4()),
                    "status": "discovering",
                    "interval": str(interval),
                    "generatedAt": now.isoformat(),
                    "updatedAt": now.isoformat(),
                    "cursor": 0,
                    "total": None,
                    "checked": 0,
                    "pairsChecked": 0,
                    "qualified": 0,
                    "activeUsdPairs": None,
                    "candidates": [],
                    "skipped": [],
                    "notes": [],
                    "failures": 0,
                    "lastError": None,
                    "liquidity": {
                        "minUsdVolume24h": str(MIN_USD_VOLUME),
                        "maxSpreadPct": str(service.settings.max_spread_pct),
                    },
                }
                self._checkpoint(owner, state)

            # Discovery and the ticker snapshot fix a deterministic, liquid
            # universe for this run. Later catalogue refreshes only recheck status.
            provider = self._configure_providers(service)
            if state["status"] == "discovering" or self._catalog_expired(state):
                catalog_request = True
                catalog = provider.discover_usd_pairs()
                state["catalog"] = {item["symbol"]: item for item in catalog}
                state["catalogAt"] = self.clock().isoformat()
                if state["status"] == "discovering":
                    active = [item for item in catalog if item["status"] == "online"]
                    selected, eligible_count = provider.rank_usd_pairs(
                        active,
                        limit=MAX_ACTIVE_USD_PAIRS,
                        min_usd_volume=MIN_USD_VOLUME,
                        max_spread_pct=Decimal(str(service.settings.max_spread_pct)),
                    )
                    stocks = [
                        {"symbol": entry.symbol, "marketType": "stocks"}
                        for entry in DEFAULT_WATCHLIST
                        if not entry.is_crypto
                    ]
                    state["markets"] = stocks + [
                        {**item, "marketType": "crypto"} for item in selected
                    ]
                    state["total"] = len(state["markets"])
                    state["activeUsdPairs"] = len(active)
                    not_scanned = len(active) - len(selected)
                    state["notes"] = [
                        f"Coverage: selected {len(selected)} of {len(active)} online Kraken USD spot pairs "
                        f"by 24h USD turnover after liquidity filters; {not_scanned} online pairs were "
                        f"not scanned (liquidity exclusions and {MAX_ACTIVE_USD_PAIRS}-pair cap; "
                        f"{eligible_count} pairs met both liquidity filters)."
                    ]
                    state["skipped"].extend(
                        {
                            "symbol": item["symbol"],
                            "reason": f"Inactive market: {item['status']}.",
                        }
                        for item in catalog
                        if item["status"] != "online"
                    )
                state["status"] = "scanning"
                state["lastError"] = None
                state["failures"] = 0
                return self._finish(owner, state)

            market = state["markets"][state["checked"]]
            try:
                reason, report = self._check_market(service, provider, market, state)
            except ProviderDataError as exc:
                reason, report = f"Market data unavailable: {exc}", None
            if reason is None and report is None:
                return self._finish(owner, state)
            if report is not None:
                # Freshness remains a hard safety boundary even when the price
                # pattern qualifies. Stale setups are rejections, never fresh opportunities.
                fresh = tuple(candidate for candidate in report.candidates if candidate.data_quality.fresh)
                stale = [candidate for candidate in report.candidates if not candidate.data_quality.fresh]
                for candidate in stale:
                    state["skipped"].append(
                        {"symbol": candidate.symbol, "reason": "Stale completed candles."}
                    )
                stored = store_report(self.session, replace(report, candidates=fresh))
                for candidate in stored:
                    state["candidates"].append(
                        {
                            "id": str(candidate.id),
                            "symbol": candidate.symbol,
                            "observedAt": candidate.observed_at.isoformat(),
                        }
                    )
                    if candidate.rejected_reason:
                        state["skipped"].append(
                            {
                                "symbol": candidate.symbol,
                                "reason": f"Sizing infeasible: {candidate.rejected_reason}",
                            }
                        )
                state["qualified"] += len(fresh)
                state["skipped"].extend(
                    {"symbol": item.symbol, "reason": item.reason} for item in report.skipped
                )
            if reason:
                state["skipped"].append({"symbol": market["symbol"], "reason": reason})
            self._advance_cursor(state, market)
            return self._finish(owner, state)
        except (ProviderRateLimited, ProviderUnavailable) as exc:
            state["failures"] = state.get("failures", 0) + 1
            state["lastError"] = str(exc)
            if (
                not catalog_request
                and not isinstance(exc, ProviderRateLimited)
                and state["failures"] >= MAX_FAILURES
                and state.get("markets")
            ):
                market = state["markets"][state["checked"]]
                state["skipped"].append(
                    {"symbol": market["symbol"], "reason": f"Market data unavailable: {exc}"}
                )
                self._advance_cursor(state, market)
            else:
                state["status"] = "paused" if state.get("markets") else "discovering"
            delay = min(60, 5 * 2 ** min(state["failures"], 4))
            if isinstance(exc, ProviderRateLimited):
                delay = max(delay, exc.retry_after_seconds or 0)
            return self._finish(owner, state, delay=delay)
        except (ProviderDataError, ProviderNotConfigured) as exc:
            state["lastError"] = str(exc)
            state["status"] = "paused" if state.get("markets") else "discovering"
            return self._finish(owner, state, delay=30)
        except Exception:
            self.session.rollback()
            self._release(owner)
            raise
        finally:
            for adapter in service.providers.values():
                client = getattr(adapter, "_client", None)
                if client is not None:
                    client.close()

    def _configure_providers(self, service: MarketDataService) -> KrakenPublicProvider:
        provider = service.provider_for(MarketType.CRYPTO)
        if not isinstance(provider, KrakenPublicProvider):
            raise ProviderNotConfigured("Kraken market data is not configured; discovery cannot run.")
        self.request_gap = max(
            BATCH_DELAY_SECONDS, 1 / max(0.01, service.settings.kraken_rate_limit_per_second)
        )
        for adapter in service.providers.values():
            adapter.timeout = min(adapter.timeout, REQUEST_TIMEOUT_SECONDS)
            adapter._retry = RetryPolicy(max_attempts=1)
            adapter._bucket = TokenBucket(
                min(1.0, max(0.01, service.settings.kraken_rate_limit_per_second)), 2
            )
        return provider

    def _catalog_expired(self, state: dict[str, Any]) -> bool:
        if not state.get("catalogAt"):
            return True
        return (
            self.clock() - datetime.fromisoformat(state["catalogAt"])
        ).total_seconds() >= CATALOG_TTL_SECONDS

    def _check_market(self, service, provider, market, state):
        entry = WatchlistEntry(market["symbol"], MarketType(market["marketType"]), market["symbol"])
        if not in_session(entry, self.clock()):
            return "The venue is closed.", None
        if entry.is_crypto:
            current = state["catalog"].get(entry.symbol)
            if current is None or current["status"] != "online":
                return f"Inactive market: {(current or {}).get('status', 'delisted')}.", None
            liquid = state.get("liquidityCheckedAt")
            if liquid is None or (self.clock() - datetime.fromisoformat(liquid)).total_seconds() > 30:
                reason = provider.check_liquidity(
                    current["pair"],
                    min_usd_volume=MIN_USD_VOLUME,
                    max_spread_pct=Decimal(str(service.settings.max_spread_pct)),
                )
                if reason:
                    return reason, None
                state["liquidityCheckedAt"] = self.clock().isoformat()
                return None, None
        adapter = service.provider_for(entry.market_type)
        if adapter is None or not adapter.is_configured():
            return f"{entry.market_type} market data is not configured.", None
        try:
            series = service.scan_candles(
                entry.symbol, CandleInterval(state["interval"]), market_type=entry.market_type
            )
        except ProviderDataError as exc:
            return f"Market data unavailable: {exc}", None

        class Source:
            def candles(self, *args, **kwargs):
                return series

        return None, OpportunityDesk(Source(), watchlist=(entry,)).scan(
            interval=CandleInterval(state["interval"]), now=self.clock()
        )

    def _advance_cursor(self, state, market):
        state.pop("liquidityCheckedAt", None)
        state["checked"] += 1
        state["pairsChecked"] += market["marketType"] == "crypto"
        state["failures"] = 0
        state["lastError"] = None
        state["status"] = "complete" if state["checked"] == state["total"] else "scanning"
        if state["status"] == "complete":
            state["notes"] = [
                *state.get("notes", []),
                "Scan complete. No conditions were loosened; candidates are research, not trades.",
            ]

    def _checkpoint(self, owner, state, *, release=False, delay=BATCH_DELAY_SECONDS):
        now = self.clock()
        state["updatedAt"] = now.isoformat()
        values = {"state": state}
        if release:
            values.update(
                lease_owner=None, lease_expires_at=None, next_batch_at=now + timedelta(seconds=delay)
            )
        saved = self.session.execute(
            update(OppScanStateRow)
            .where(
                OppScanStateRow.id == 1,
                OppScanStateRow.lease_owner == owner,
                OppScanStateRow.lease_expires_at > now,
            )
            .values(**values)
            .execution_options(synchronize_session=False)
        ).rowcount
        if not saved:
            self.session.rollback()
            raise BadRequest("The scan lease expired; read status and resume the acknowledged cursor.")
        self.session.commit()

    def _finish(self, owner, state, *, delay=BATCH_DELAY_SECONDS, advance=True):
        if advance:
            state["cursor"] += 1
        delay = max(delay, self.request_gap) if advance else delay
        self._checkpoint(owner, state, release=True, delay=delay)
        return self.status()

    def _release(self, owner):
        self.session.execute(
            update(OppScanStateRow)
            .where(OppScanStateRow.id == 1, OppScanStateRow.lease_owner == owner)
            .values(lease_owner=None, lease_expires_at=None)
        )
        self.session.commit()
