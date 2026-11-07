"""Intelligence collection entry point.

Collection is deliberately not an API endpoint. A research collector that can be
triggered by an HTTP request is an unauthenticated way to make the engine fetch
arbitrary URLs at an attacker's pace. It runs from the scheduler or from here.

    python -m wands.intelligence.cli ingest --ciks 0000320193
    python -m wands.intelligence.cli signals --symbols AAPL
    python -m wands.intelligence.cli institutions --ciks 0001067983
    python -m wands.intelligence.cli prices --symbols AAPL MSFT
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


def _backfill(args: argparse.Namespace) -> int:
    from datetime import date

    from wands.intelligence.backfill import BackfillRunner

    settings = get_settings()
    start = date.fromisoformat(args.start) if args.start else None
    end = date.fromisoformat(args.end) if args.end else None
    with session_scope() as session:
        result = BackfillRunner(session, settings).run(
            ciks=_split(args.ciks),
            form_family=args.form_family,
            start=start,
            end=end,
            max_filings=args.max_filings,
        )
        print(json.dumps(result.as_dict(), indent=2))
    return 0 if result.status in {"ok", "partial", "paused"} else 1


def _experiment(args: argparse.Namespace) -> int:
    from wands.intelligence.experiments import ExperimentDefinition, ExperimentRunner
    from wands.intelligence.research import ResearchService

    settings = get_settings()
    with session_scope() as session:
        service = ResearchService(session, settings)
        definition = service.default_experiment_definition()
        if args.start or args.end:
            definition = ExperimentDefinition(
                **{
                    **definition.__dict__,
                    "period_start": (
                        datetime.fromisoformat(args.start).replace(tzinfo=UTC)
                        if args.start
                        else definition.period_start
                    ),
                    "period_end": (
                        datetime.fromisoformat(args.end).replace(tzinfo=UTC)
                        if args.end
                        else definition.period_end
                    ),
                }
            )
        outcome = ExperimentRunner(session, settings).run(definition)
        print(json.dumps(outcome.as_dict(), indent=2, default=str))
    return 0


def _jobs(args: argparse.Namespace) -> int:
    from wands.intelligence.jobs import JobScheduler

    settings = get_settings()
    scheduler = JobScheduler(settings)
    if args.run:
        print(json.dumps(scheduler.run_job(args.run), indent=2, default=str))
        return 0
    if args.recover:
        print(json.dumps({"recovered": scheduler.recover()}, indent=2))
        return 0
    print(json.dumps(scheduler.status(), indent=2, default=str))
    return 0


def _coverage(_: argparse.Namespace) -> int:
    from wands.intelligence.research import ResearchService

    settings = get_settings()
    with session_scope() as session:
        payload = ResearchService(session, settings).coverage()
        print(json.dumps(payload.model_dump(mode="json"), indent=2, default=str))
    return 0


def _prices(args: argparse.Namespace) -> int:
    from datetime import date, timedelta

    from wands.marketdata.history import (
        RESEARCH_UNIVERSE,
        HistoricalBarCollector,
        coverage_report,
    )

    settings = get_settings()
    end = date.fromisoformat(args.end) if args.end else datetime.now(tz=UTC).date()
    start = (
        date.fromisoformat(args.start) if args.start else end - timedelta(days=args.days)
    )
    symbols = _split(args.symbols) or list(RESEARCH_UNIVERSE)
    with session_scope() as session:
        collector = HistoricalBarCollector(session, settings)
        results = collector.collect(symbols, start=start, end=end)
        session.flush()
        print(
            json.dumps(
                {
                    "window": {"start": start.isoformat(), "end": end.isoformat()},
                    "results": [item.as_dict() for item in results],
                    "coverage": coverage_report(session, symbols),
                },
                indent=2,
            )
        )
    return 0 if all(item.status in {"complete", "partial"} for item in results) else 1


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

    backfill = sub.add_parser("backfill", help="Crawl historical SEC archive pages")
    backfill.add_argument("--ciks", nargs="*", help="Issuer CIKs; defaults to the watchlist")
    backfill.add_argument(
        "--form-family", default="ownership", choices=["ownership", "institutional"]
    )
    backfill.add_argument("--start", help="ISO start date; defaults to the configured bound")
    backfill.add_argument("--end", help="ISO end date; defaults to an open interval")
    backfill.add_argument("--max-filings", type=int, default=None)
    backfill.set_defaults(handler=_backfill)

    experiment = sub.add_parser("experiment", help="Run and record a validation experiment")
    experiment.add_argument("--start", help="ISO period start")
    experiment.add_argument("--end", help="ISO period end")
    experiment.set_defaults(handler=_experiment)

    jobs = sub.add_parser("jobs", help="Inspect or run scheduled research jobs")
    jobs.add_argument("--run", help="Run one job by name")
    jobs.add_argument("--recover", action="store_true", help="Reclaim expired leases")
    jobs.set_defaults(handler=_jobs)

    coverage = sub.add_parser("coverage", help="Report collection and identifier coverage")
    coverage.set_defaults(handler=_coverage)

    prices = sub.add_parser("prices", help="Collect historical daily OHLCV bars")
    prices.add_argument(
        "--symbols", nargs="*", help="Symbols; defaults to the research universe"
    )
    prices.add_argument("--start", help="ISO start date")
    prices.add_argument("--end", help="ISO end date; defaults to today")
    prices.add_argument(
        "--days", type=int, default=365, help="Lookback when --start is omitted"
    )
    prices.set_defaults(handler=_prices)

    args = parser.parse_args(argv)
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
