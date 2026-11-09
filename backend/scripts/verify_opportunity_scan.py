"""Real Kraken smoke test against a disposable local database, never production.

Discovers the entire catalogue, then checks representative pairs through the
production coordinator/storage code. This is a sample scan, not a full-market
performance or profitability test. No credentials, order routes or deployment.
"""

from __future__ import annotations

import json
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from wands.api.routes.opportunity import _store_report
from wands.config import Settings
from wands.db.base import Base
from wands.db.models import OppScanStateRow
from wands.marketdata.kraken import KrakenPublicProvider
from wands.marketdata.service import MarketDataService
from wands.opportunity.scanner import ScanCoordinator
from wands.schemas import MarketType


def main():
    with tempfile.TemporaryDirectory(prefix="wands-live-scanner-") as directory:
        engine = create_engine(f"sqlite:///{Path(directory) / 'scan.db'}")
        Base.metadata.create_all(engine)
        with Session(engine) as session:

            def advance(state=None):
                if state and state.get("nextBatchAt"):
                    time.sleep(
                        max(
                            0,
                            (
                                datetime.fromisoformat(state["nextBatchAt"]) - datetime.now(UTC)
                            ).total_seconds(),
                        )
                    )
                service = MarketDataService(
                    session,
                    settings=Settings(market_data_enabled=True),
                    providers={MarketType.CRYPTO: KrakenPublicProvider()},
                )
                started = time.monotonic()
                result = ScanCoordinator(session).advance(
                    service=service,
                    store_report=_store_report,
                    **({"run_id": state["runId"], "cursor": state["cursor"]} if state else {}),
                )
                duration = time.monotonic() - started
                assert duration < 12, f"Batch exceeded frontend budget: {duration}"
                assert not result["lastError"], result["lastError"]
                print(
                    json.dumps(
                        {
                            "batchSeconds": round(duration, 3),
                            "cursor": result["cursor"],
                            "checked": result["checked"],
                            "qualified": result["qualified"],
                        }
                    ),
                    flush=True,
                )
                return result

            state = advance()
            assert state["activeUsdPairs"] > 6, state
            discovered = state["total"] - 4
            row = session.get(OppScanStateRow, 1)
            full = dict(row.state)
            symbols = {"BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD", "0G/USD"}
            selected = [item for item in full["markets"] if item["symbol"] in symbols]
            inactive = next(
                (
                    item
                    for item in full["markets"]
                    if item.get("status") != "online" and item["marketType"] == "crypto"
                ),
                None,
            )
            if inactive:
                selected.append(inactive)
            full["markets"] = selected
            full["total"] = len(selected)
            row.state = full
            session.commit()
            while state["status"] != "complete":
                state = advance(state)
            assert state["pairsChecked"] == len(selected)
            print(
                json.dumps(
                    {
                        "discoveredUsdPairs": discovered,
                        "activeUsdPairs": state["activeUsdPairs"],
                        "sampleChecked": state["pairsChecked"],
                        "qualified": state["qualified"],
                        "skipped": state["skipped"],
                        "candidates": state["candidates"],
                    },
                    indent=2,
                )
            )


if __name__ == "__main__":
    main()
