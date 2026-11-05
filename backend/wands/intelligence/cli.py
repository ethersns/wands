"""Intelligence collection entry point.

Collection is deliberately not an API endpoint. A research collector that can be
triggered by an HTTP request is an unauthenticated way to make the engine fetch
arbitrary URLs at an attacker's pace. It runs from the scheduler or from here.

    python -m wands.intelligence.cli ingest --ciks 0000320193
    python -m wands.intelligence.cli signals --symbols AAPL
    python -m wands.intelligence.cli institutions --ciks 0001067983
    python -m wands.intelligence.cli status
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime

from wands.config import get_settings
from wands.db.session import session_scope
from wands.intelligence.freshness import FreshnessMonitor
from wands.intelligence.ingest import InsiderIngestor, InstitutionalIngestor
from wands.intelligence.institutions import InstitutionalRadar
from wands.intelligence.signals import InsiderSignalEngine


def _split(values: list[str] | None) -> list[str] | None:
    if not values:
        return None
    items: list[str] = []
    for value in values:
        items.extend(part.strip() for part in value.split(",") if part.strip())
    return items or None


def _ingest(args: argparse.Namespace) -> int:
    settings = get_settings()
    with session_scope() as session:
        result = InsiderIngestor(session, settings).run(ciks=_split(args.ciks))
        if result.filings_new:
            result.signals_new = InsiderSignalEngine(session, settings).compute_and_persist()
        print(
            json.dumps(
                {
                    "status": result.status,
                    "filingsSeen": result.filings_seen,
                    "filingsNew": result.filings_new,
                    "transactionsNew": result.transactions_new,
                    "signalsNew": result.signals_new,
                    "errors": result.errors,
                },
                indent=2,
            )
        )
    return 0 if result.status in {"ok", "partial"} else 1


def _institutions(args: argparse.Namespace) -> int:
    settings = get_settings()
    ciks = _split(args.ciks)
    if not ciks:
        print("--ciks is required for institutional collection.", file=sys.stderr)
        return 2
    with session_scope() as session:
        result = InstitutionalIngestor(session, settings).run(ciks=ciks)
        if result.filings_new:
            result.signals_new = InstitutionalRadar(session, settings).persist_signals(ciks)
        print(
            json.dumps(
                {
                    "status": result.status,
                    "filingsSeen": result.filings_seen,
                    "filingsNew": result.filings_new,
                    "holdingsNew": result.transactions_new,
                    "signalsNew": result.signals_new,
                    "errors": result.errors,
                },
                indent=2,
            )
        )
    return 0 if result.status in {"ok", "partial"} else 1


def _signals(args: argparse.Namespace) -> int:
    settings = get_settings()
    with session_scope() as session:
        created = InsiderSignalEngine(session, settings).compute_and_persist(
            symbols=_split(args.symbols)
        )
        print(json.dumps({"signalsNew": created}, indent=2))
    return 0


def _status(_: argparse.Namespace) -> int:
    settings = get_settings()
    with session_scope() as session:
        monitor = FreshnessMonitor(session, settings)
        print(
            json.dumps(
                {
                    "overall": monitor.overall(),
                    "sources": [
                        {
                            "source": item.source,
                            "status": item.status,
                            "lastSuccessAt": (
                                item.last_success_at.isoformat()
                                if item.last_success_at
                                else None
                            ),
                            "ageSeconds": item.age_seconds,
                            "detail": item.detail,
                        }
                        for item in monitor.sources(now=datetime.now(tz=UTC))
                    ],
                },
                indent=2,
            )
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="wands-intelligence")
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest", help="Collect SEC ownership filings")
    ingest.add_argument("--ciks", nargs="*", help="Issuer CIKs; defaults to the watchlist")
    ingest.set_defaults(handler=_ingest)

    institutions = sub.add_parser("institutions", help="Collect 13F filings")
    institutions.add_argument("--ciks", nargs="*", help="Institution CIKs")
    institutions.set_defaults(handler=_institutions)

    signals = sub.add_parser("signals", help="Recompute insider signals")
    signals.add_argument("--symbols", nargs="*", help="Symbols; defaults to all stored")
    signals.set_defaults(handler=_signals)

    status = sub.add_parser("status", help="Report data freshness")
    status.set_defaults(handler=_status)

    args = parser.parse_args(argv)
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
