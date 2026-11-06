"""Historical SEC backfill: resumption, partial failure and honest counting.

The properties under test are the ones that decide whether a historical dataset
can be trusted: the cursor only advances past filings that were actually
persisted, a document that could not be fetched is counted rather than invented,
and a resumed run does not re-download what it already has.
"""

from __future__ import annotations

import threading
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select

from wands.config import get_settings
from wands.db.models import (
    IntelBackfillCheckpointRow,
    IntelFilingRow,
    IntelInsiderTransactionRow,
)
from wands.intelligence.backfill import (
    STREAM_COMPLETE,
    STREAM_PAUSED,
    BackfillRunner,
)
from wands.intelligence.base import SourceDataError, SourceUnavailable
from wands.intelligence.ingest import InsiderIngestor

from .intelligence_fakes import FakeEdgarClient, filing_ref, form4_xml

CIK = "0000320193"
BASE = datetime(2016, 3, 1, 18, 0, tzinfo=UTC)


def _client(*, count: int = 3, archive: int = 2) -> FakeEdgarClient:
    client = FakeEdgarClient()
    recent = []
    for index in range(count):
        accession = f"0000320193-16-00000{index}"
        accepted = BASE + timedelta(days=index * 30)
        recent.append(filing_ref(accession, accepted_at=accepted))
        client.documents[accession] = form4_xml(
            transactions=[{"code": "P", "date": "2016-02-01", "shares": 100, "price": "100"}]
        )
    client.filings[CIK] = recent

    older = []
    for index in range(archive):
        accession = f"0000320193-12-00000{index}"
        accepted = datetime(2012, 1, 1, tzinfo=UTC) + timedelta(days=index * 30)
        older.append(filing_ref(accession, accepted_at=accepted))
        client.documents[accession] = form4_xml(
            transactions=[{"code": "P", "date": "2011-12-01", "shares": 50, "price": "80"}]
        )
    client.archive[CIK] = older
    return client


def _runner(session, client, **kwargs):
    settings = get_settings()
    return BackfillRunner(
        session,
        settings,
        client=client,
        ingestor=InsiderIngestor(session, settings, client=client),
        **kwargs,
    )


def test_backfill_reaches_archive_pages_not_only_the_recent_block(session):
    client = _client(count=3, archive=2)
    # The archive fixtures are from 2012, so the window has to reach back that
    # far. That is also the point: the range is configurable.
    result = _runner(session, client).run(ciks=[CIK], start=date(2010, 1, 1))

    assert result.status == "ok"
    assert result.filings_new == 5
    # The archive page was actually requested, which is the whole point.
    assert f"all_filings:{CIK}" in client.calls
    assert session.scalar(select(func.count()).select_from(IntelFilingRow)) == 5


def test_the_cursor_advances_only_past_persisted_filings(session):
    client = _client(count=3, archive=0)
    _runner(session, client).run(ciks=[CIK])

    checkpoint = session.scalar(select(IntelBackfillCheckpointRow))
    assert checkpoint.status == STREAM_COMPLETE
    assert checkpoint.cursor_accepted_at == BASE + timedelta(days=60)
    assert checkpoint.cursor_accession == "0000320193-16-000002"
    assert checkpoint.filings_new == 3


def test_a_second_run_skips_what_is_already_stored(session):
    client = _client(count=3, archive=0)
    _runner(session, client).run(ciks=[CIK])
    second = _runner(session, client).run(ciks=[CIK])

    assert second.filings_new == 0
    # The cursor filing is replayed on purpose; dedupe makes it a no-op.
    assert second.filings_skipped >= 1
    assert session.scalar(select(func.count()).select_from(IntelFilingRow)) == 3


def test_an_unavailable_document_is_counted_and_not_invented(session):
    client = _client(count=3, archive=0)
    # Remove one document so the fetch fails with a data error.
    del client.documents["0000320193-16-000001"]

    result = _runner(session, client).run(ciks=[CIK])

    assert result.filings_unavailable == 1
    assert result.filings_new == 2
    assert result.status == "partial"
    # Nothing was fabricated to fill the gap.
    assert session.scalar(select(func.count()).select_from(IntelFilingRow)) == 2


def test_a_malformed_document_is_counted_separately(session):
    client = _client(count=2, archive=0)
    client.documents["0000320193-16-000000"] = b"<not-an-ownership-document/>"

    result = _runner(session, client).run(ciks=[CIK])

    assert result.filings_malformed == 1
    assert result.filings_new == 1


def test_a_transport_failure_on_discovery_fails_the_stream_without_losing_others(session):
    client = _client(count=2, archive=0)
    client.fail_with = SourceUnavailable("SEC is down")
    client.fail_times = 1

    result = _runner(session, client).run(ciks=[CIK])

    assert result.failed == 1
    assert result.filings_new == 0
    checkpoint = session.scalar(select(IntelBackfillCheckpointRow))
    assert checkpoint.status == "failed"
    assert "SEC is down" in checkpoint.last_error


def test_a_stop_request_pauses_the_stream_and_keeps_the_cursor(session):
    """A shutdown mid-crawl leaves a resumable checkpoint, not a half-written run."""
    client = _client(count=4, archive=0)
    stop = threading.Event()

    original = client.all_filings

    def all_filings_then_stop(*args, **kwargs):
        refs = original(*args, **kwargs)
        # The shutdown arrives after discovery and before the first batch.
        stop.set()
        return refs

    client.all_filings = all_filings_then_stop  # type: ignore[method-assign]

    result = _runner(session, client).run(ciks=[CIK], stop_event=stop)

    assert result.stopped_early is True
    assert result.paused == 1
    checkpoint = session.scalar(select(IntelBackfillCheckpointRow))
    assert checkpoint.status == STREAM_PAUSED
    # Nothing was persisted, so the cursor did not move.
    assert checkpoint.cursor_accepted_at is None


def test_a_stop_request_before_any_work_starts_no_stream(session):
    client = _client(count=4, archive=0)
    stop = threading.Event()
    stop.set()

    result = _runner(session, client).run(ciks=[CIK], stop_event=stop)

    assert result.stopped_early is True
    assert result.streams == 0
    assert client.calls == []


def test_an_amendment_is_stored_as_its_own_filing(session):
    client = FakeEdgarClient()
    original = filing_ref("0000320193-16-000001", accepted_at=BASE)
    amendment = filing_ref(
        "0000320193-16-000002", accepted_at=BASE + timedelta(days=5), form_type="4/A"
    )
    client.filings[CIK] = [original, amendment]
    client.documents[original.accession_number] = form4_xml()
    client.documents[amendment.accession_number] = form4_xml(document_type="4/A")

    _runner(session, client).run(ciks=[CIK])

    rows = session.scalars(
        select(IntelFilingRow).order_by(IntelFilingRow.accepted_at)
    ).all()
    assert len(rows) == 2
    assert rows[0].is_amendment is False
    assert rows[1].is_amendment is True
    # The amendment is linked to the filing it amends.
    assert rows[1].amends_accession == original.accession_number


def test_the_window_bounds_are_applied_to_acceptance_time(session):
    client = _client(count=3, archive=0)
    result = _runner(session, client).run(
        ciks=[CIK],
        start=datetime(2016, 3, 15, tzinfo=UTC).date(),
        end=datetime(2016, 4, 15, tzinfo=UTC).date(),
    )

    # Only the filing accepted on 2016-03-31 falls inside the window.
    assert result.filings_new == 1


def test_bounded_concurrency_still_persists_every_filing(session):
    client = _client(count=6, archive=0)
    result = _runner(session, client).run(ciks=[CIK], max_workers=3)

    assert result.filings_new == 6
    assert session.scalar(select(func.count()).select_from(IntelFilingRow)) == 6
    assert session.scalar(select(func.count()).select_from(IntelInsiderTransactionRow)) == 6


def test_max_filings_caps_the_crawl(session):
    client = _client(count=6, archive=0)
    result = _runner(session, client).run(ciks=[CIK], max_filings=2)

    assert result.filings_new == 2


def test_progress_reports_every_stream(session):
    client = _client(count=2, archive=0)
    runner = _runner(session, client)
    runner.run(ciks=[CIK])

    progress = runner.progress()
    assert len(progress) == 1
    assert progress[0].issuer_cik == CIK
    assert progress[0].filings_new == 2
    assert progress[0].as_dict()["filingsNew"] == 2


class _Response:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        import json

        self.status_code = status_code
        self.content = json.dumps(payload).encode()

    @property
    def text(self) -> str:
        return self.content.decode()


class _Http:
    """A stand-in for httpx that serves the submissions JSON shape."""

    def __init__(self, pages: dict[str, dict]) -> None:
        self.pages = pages
        self.requested: list[str] = []

    def get(self, url: str, **kwargs):
        self.requested.append(url)
        for suffix, payload in self.pages.items():
            if url.endswith(suffix):
                return _Response(payload)
        return _Response({}, status_code=404)


def _submissions_payload(*, archive: bool) -> dict:
    recent = {
        "accessionNumber": ["0000320193-24-000001"],
        "form": ["4"],
        "filingDate": ["2024-02-01"],
        "acceptanceDateTime": ["2024-02-01T18:00:00.000Z"],
        "primaryDocument": ["primary.xml"],
        "reportDate": ["2024-01-31"],
    }
    payload = {
        "name": "Apple Inc.",
        "tickers": ["AAPL"],
        "filings": {"recent": recent, "files": []},
    }
    if archive:
        payload["filings"]["files"] = [
            {
                "name": "CIK0000320193-submissions-001.json",
                "filingCount": 1,
                "filingFrom": "2012-01-01",
                "filingTo": "2019-12-31",
            }
        ]
    return payload


def _archive_payload() -> dict:
    return {
        "accessionNumber": ["0000320193-12-000001"],
        "form": ["4"],
        "filingDate": ["2012-03-01"],
        "acceptanceDateTime": ["2012-03-01T18:00:00.000Z"],
        "primaryDocument": ["primary.xml"],
        "reportDate": ["2012-02-28"],
    }


def test_the_client_reads_archive_pages_for_older_history():
    from wands.intelligence.edgar import EdgarClient

    http = _Http(
        {
            "CIK0000320193.json": _submissions_payload(archive=True),
            "CIK0000320193-submissions-001.json": _archive_payload(),
        }
    )
    client = EdgarClient(user_agent="wands-test/1.0 (test)", client=http)

    refs = client.all_filings("0000320193")

    assert {ref.accession_number for ref in refs} == {
        "0000320193-24-000001",
        "0000320193-12-000001",
    }
    assert any("submissions-001" in url for url in http.requested)


def test_the_client_reports_archive_pages_it_could_not_load():
    from wands.intelligence.edgar import EdgarClient

    # The archive page is declared but the request 404s.
    http = _Http({"CIK0000320193.json": _submissions_payload(archive=True)})
    client = EdgarClient(user_agent="wands-test/1.0 (test)", client=http)

    refs = client.all_filings("0000320193")

    # The recent filing survives; the gap is a missing page, not a crash.
    assert [ref.accession_number for ref in refs] == ["0000320193-24-000001"]


def test_the_client_applies_the_until_bound():
    from wands.intelligence.edgar import EdgarClient

    http = _Http(
        {
            "CIK0000320193.json": _submissions_payload(archive=True),
            "CIK0000320193-submissions-001.json": _archive_payload(),
        }
    )
    client = EdgarClient(user_agent="wands-test/1.0 (test)", client=http)

    refs = client.all_filings(
        "0000320193", until=datetime(2015, 1, 1, tzinfo=UTC)
    )

    assert [ref.accession_number for ref in refs] == ["0000320193-12-000001"]


def test_the_intelligence_package_cannot_reach_the_order_path():
    """Acceptance criterion: research has no execution access.

    Asserted on the import graph rather than on convention, because a comment
    cannot stop a future import.
    """
    import ast
    from pathlib import Path

    import wands.intelligence as package

    forbidden = {"wands.execution", "wands.brokers", "wands.risk", "wands.portfolio"}
    root = Path(package.__file__).parent
    offenders: list[str] = []
    for path in root.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                if any(node.module.startswith(name) for name in forbidden):
                    offenders.append(f"{path.name}: {node.module}")
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if any(alias.name.startswith(name) for name in forbidden):
                        offenders.append(f"{path.name}: {alias.name}")
    assert offenders == [], f"intelligence imports the execution path: {offenders}"


def test_a_disabled_collector_sends_no_request(session):
    client = _client()
    settings = get_settings().model_copy(update={"intelligence_enabled": False})
    runner = BackfillRunner(
        session,
        settings,
        client=client,
        ingestor=InsiderIngestor(session, settings, client=client),
    )

    result = runner.run(ciks=[CIK])

    assert result.status == "failed"
    assert client.calls == []
