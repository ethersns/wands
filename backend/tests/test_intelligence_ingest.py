"""Ingestion: deduplication, retries, source failures and fair access.

The SEC client is exercised against a fake transport so the tests can assert on
the request headers and on which failures are retried. Nothing here reaches the
network.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from wands.config import get_settings
from wands.db.models import (
    IntelFilingRow,
    IntelIngestRunRow,
    IntelInsiderTransactionRow,
)
from wands.intelligence.base import (
    SourceDataError,
    SourceNotConfigured,
    SourceRateLimited,
    SourceUnavailable,
)
from wands.intelligence.edgar import EdgarClient, acceptance_time, raw_document_path
from wands.intelligence.ingest import InsiderIngestor, resolve_issuer_ciks
from wands.intelligence.retry import RetryPolicy, call_with_retry

from .intelligence_fakes import FakeEdgarClient, filing_ref, form4_xml

ACCEPTED = datetime(2024, 2, 1, 18, 0, tzinfo=UTC)
# The fixtures are historical, so the collection window is pinned rather than
# derived from the wall clock.
WINDOW_START = datetime(2024, 1, 1, tzinfo=UTC)


# --------------------------------------------------------------------------
# Transport
# --------------------------------------------------------------------------


class FakeResponse:
    def __init__(self, status_code: int = 200, content: bytes = b"{}") -> None:
        self.status_code = status_code
        self.content = content


class FakeHttp:
    def __init__(self, responses: list[FakeResponse | Exception]) -> None:
        self.responses = list(responses)
        self.requests: list[dict] = []

    def get(self, url: str, timeout=None, headers=None):
        self.requests.append({"url": url, "headers": headers or {}})
        if not self.responses:
            raise AssertionError("unexpected request")
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _client(http: FakeHttp, **overrides) -> EdgarClient:
    return EdgarClient(
        user_agent=overrides.pop("user_agent", "wands-research/0.1 (ops@example.com)"),
        client=http,
        retry_policy=RetryPolicy(max_attempts=3, base_delay_seconds=0.0),
        sleep=lambda _: None,
        **overrides,
    )


def test_client_sends_a_descriptive_user_agent():
    http = FakeHttp([FakeResponse(200, b'{"ok": true}')])
    _client(http).submissions("320193")
    assert http.requests[0]["headers"]["User-Agent"].startswith("wands-research/")


def test_client_refuses_to_send_without_a_user_agent():
    http = FakeHttp([])
    client = _client(http, user_agent="")
    assert client.is_configured() is False
    with pytest.raises(SourceNotConfigured):
        client.submissions("320193")
    assert http.requests == [], "no request may be sent without an identifying agent"


def test_rate_limit_response_is_retried_then_succeeds():
    http = FakeHttp([FakeResponse(429), FakeResponse(200, b'{"ok": true}')])
    payload = _client(http).submissions("320193")
    assert payload == {"ok": True}
    assert len(http.requests) == 2


def test_server_error_is_retried_and_eventually_raises():
    http = FakeHttp([FakeResponse(503), FakeResponse(503), FakeResponse(503)])
    with pytest.raises(SourceUnavailable):
        _client(http).submissions("320193")
    assert len(http.requests) == 3


def test_not_found_is_not_retried():
    http = FakeHttp([FakeResponse(404)])
    with pytest.raises(SourceDataError):
        _client(http).submissions("320193")
    assert len(http.requests) == 1, "a 404 will not become a 200 on a second attempt"


def test_malformed_json_is_not_retried():
    http = FakeHttp([FakeResponse(200, b"not json")])
    with pytest.raises(SourceDataError):
        _client(http).submissions("320193")
    assert len(http.requests) == 1


def test_retry_policy_gives_up_after_max_attempts():
    attempts = {"count": 0}

    def operation():
        attempts["count"] += 1
        raise SourceUnavailable("down")

    with pytest.raises(SourceUnavailable):
        call_with_retry(
            operation,
            policy=RetryPolicy(max_attempts=2, base_delay_seconds=0.0),
            sleep=lambda _: None,
        )
    assert attempts["count"] == 2


def test_retry_policy_does_not_retry_a_data_error():
    attempts = {"count": 0}

    def operation():
        attempts["count"] += 1
        raise SourceDataError("bad payload")

    with pytest.raises(SourceDataError):
        call_with_retry(
            operation,
            policy=RetryPolicy(max_attempts=3, base_delay_seconds=0.0),
            sleep=lambda _: None,
        )
    assert attempts["count"] == 1


# --------------------------------------------------------------------------
# Acceptance time
# --------------------------------------------------------------------------


def test_acceptance_time_uses_the_precise_timestamp_when_present():
    value = acceptance_time("2024-02-01", "2024-02-01T18:30:00.000Z")
    assert value == datetime(2024, 2, 1, 18, 30, tzinfo=UTC)


def test_acceptance_time_falls_back_to_the_end_of_the_filing_date():
    """Falling back to midnight would let a backtest see the filing a day early."""
    value = acceptance_time("2024-02-01", "")
    assert value == datetime(2024, 2, 2, tzinfo=UTC)
    assert value > datetime(2024, 2, 1, 23, 59, tzinfo=UTC)


def test_acceptance_time_is_none_without_a_usable_date():
    assert acceptance_time("", "") is None


def test_recent_filings_skips_entries_without_a_publication_time():
    submissions = {
        "name": "Apple Inc.",
        "tickers": ["AAPL"],
        "filings": {
            "recent": {
                "accessionNumber": ["0000320193-24-000001"],
                "form": ["4"],
                "filingDate": [""],
                "acceptanceDateTime": [""],
                "primaryDocument": ["primary.xml"],
                "reportDate": ["2024-01-15"],
            }
        },
    }
    http = FakeHttp([FakeResponse(200, json.dumps(submissions).encode())])
    assert _client(http).recent_filings("320193") == []


def test_recent_filings_filters_by_form_and_window():
    submissions = {
        "name": "Apple Inc.",
        "tickers": ["AAPL"],
        "filings": {
            "recent": {
                "accessionNumber": ["a-1", "a-2", "a-3"],
                "form": ["4", "10-K", "4"],
                "filingDate": ["2024-02-01", "2024-02-01", "2020-01-01"],
                "acceptanceDateTime": [
                    "2024-02-01T18:00:00.000Z",
                    "2024-02-01T18:00:00.000Z",
                    "2020-01-01T18:00:00.000Z",
                ],
                "primaryDocument": ["p1.xml", "p2.htm", "p3.xml"],
                "reportDate": ["2024-01-15", "2023-12-31", "2019-12-31"],
            }
        },
    }
    http = FakeHttp([FakeResponse(200, json.dumps(submissions).encode())])
    refs = _client(http).recent_filings(
        "320193", since=datetime(2024, 1, 1, tzinfo=UTC)
    )
    assert [ref.accession_number for ref in refs] == ["a-1"]


# --------------------------------------------------------------------------
# Ingestion
# --------------------------------------------------------------------------


def _ingestor(session, client) -> InsiderIngestor:
    return InsiderIngestor(session, get_settings(), client=client)


def test_ingest_persists_filings_and_transactions(session):
    client = FakeEdgarClient(
        documents={"0000320193-24-000001": form4_xml()},
        filings={"0000320193": [filing_ref("0000320193-24-000001", accepted_at=ACCEPTED)]},
    )
    result = _ingestor(session, client).run(ciks=["0000320193"], since=WINDOW_START)

    assert result.status == "ok"
    assert result.filings_new == 1
    assert result.transactions_new == 1
    assert session.scalar(select(func.count()).select_from(IntelFilingRow)) == 1
    assert session.scalar(select(func.count()).select_from(IntelInsiderTransactionRow)) == 1


def test_ingest_is_idempotent(session):
    client = FakeEdgarClient(
        documents={"0000320193-24-000001": form4_xml()},
        filings={"0000320193": [filing_ref("0000320193-24-000001", accepted_at=ACCEPTED)]},
    )
    ingestor = _ingestor(session, client)

    first = ingestor.run(ciks=["0000320193"], since=WINDOW_START)
    second = ingestor.run(ciks=["0000320193"], since=WINDOW_START)

    assert first.filings_new == 1
    assert second.filings_new == 0
    assert second.filings_seen == 1
    assert session.scalar(select(func.count()).select_from(IntelFilingRow)) == 1
    assert session.scalar(select(func.count()).select_from(IntelInsiderTransactionRow)) == 1


def test_ingest_does_not_refetch_a_stored_filing(session):
    client = FakeEdgarClient(
        documents={"0000320193-24-000001": form4_xml()},
        filings={"0000320193": [filing_ref("0000320193-24-000001", accepted_at=ACCEPTED)]},
    )
    ingestor = _ingestor(session, client)
    ingestor.run(ciks=["0000320193"], since=WINDOW_START)
    ingestor.run(ciks=["0000320193"], since=WINDOW_START)

    document_calls = [call for call in client.calls if call.startswith("document:")]
    assert len(document_calls) == 1


def test_ingest_records_a_run_row(session):
    client = FakeEdgarClient(
        documents={"0000320193-24-000001": form4_xml()},
        filings={"0000320193": [filing_ref("0000320193-24-000001", accepted_at=ACCEPTED)]},
    )
    _ingestor(session, client).run(ciks=["0000320193"], since=WINDOW_START)

    run = session.scalar(select(IntelIngestRunRow))
    assert run is not None
    assert run.status == "ok"
    assert run.finished_at is not None
    assert run.filings_new == 1


def test_a_source_failure_is_recorded_without_losing_the_run(session):
    client = FakeEdgarClient(fail_with=SourceUnavailable("SEC is down"), fail_times=1)
    result = _ingestor(session, client).run(ciks=["0000320193"], since=WINDOW_START)

    assert result.status == "failed"
    assert result.errors
    assert result.errors[0]["stage"] == "discovery"

    run = session.scalar(select(IntelIngestRunRow))
    assert run is not None and run.status == "failed"


def test_a_bad_document_does_not_abort_the_whole_run(session):
    client = FakeEdgarClient(
        documents={"0000320193-24-000002": form4_xml()},
        filings={
            "0000320193": [
                filing_ref("0000320193-24-000001", accepted_at=ACCEPTED),
                filing_ref("0000320193-24-000002", accepted_at=ACCEPTED),
            ]
        },
    )
    result = _ingestor(session, client).run(ciks=["0000320193"], since=WINDOW_START)

    assert result.status == "partial"
    assert result.filings_new == 1
    assert len(result.errors) == 1
    assert result.errors[0]["accession"] == "0000320193-24-000001"


def test_disabled_intelligence_collects_nothing(session, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "intelligence_enabled", False)
    client = FakeEdgarClient()
    result = InsiderIngestor(session, settings, client=client).run(ciks=["0000320193"], since=WINDOW_START)

    assert result.status == "failed"
    assert result.errors[0]["stage"] == "config"
    assert client.calls == []


def test_no_issuers_is_reported_rather_than_silently_empty(session):
    client = FakeEdgarClient()
    result = _ingestor(session, client).run(ciks=[])

    assert result.status == "failed"
    assert "No issuer CIKs" in result.errors[0]["message"]


def test_issuer_ciks_are_derived_from_the_equity_watchlist(session, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "intelligence_insider_ciks", "")
    monkeypatch.setattr(settings, "market_watchlist", "BTC/USD,AAPL,MSFT")
    client = FakeEdgarClient(tickers={"AAPL": "0000320193", "MSFT": "0000789019"})

    assert resolve_issuer_ciks(settings, client) == ["0000320193", "0000789019"]


def test_explicit_issuer_ciks_win_over_the_watchlist(session, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "intelligence_insider_ciks", "0000000001, 0000000002")
    client = FakeEdgarClient(tickers={"AAPL": "0000320193"})

    assert resolve_issuer_ciks(settings, client) == ["0000000001", "0000000002"]


def test_amendment_is_linked_to_the_filing_it_amends(session):
    client = FakeEdgarClient(
        documents={
            "0000320193-24-000010": form4_xml(),
            "0000320193-24-000011": form4_xml(
                document_type="4/A", original_submission="2024-02-01"
            ),
        },
        filings={
            "0000320193": [
                filing_ref("0000320193-24-000010", accepted_at=ACCEPTED),
                filing_ref(
                    "0000320193-24-000011",
                    accepted_at=ACCEPTED + timedelta(days=3),
                    form_type="4/A",
                ),
            ]
        },
    )
    _ingestor(session, client).run(ciks=["0000320193"], since=WINDOW_START)

    amendment = session.scalar(
        select(IntelFilingRow).where(
            IntelFilingRow.accession_number == "0000320193-24-000011"
        )
    )
    assert amendment is not None
    assert amendment.is_amendment is True
    assert amendment.amends_accession == "0000320193-24-000010"


@pytest.mark.parametrize(
    ("primary", "expected"),
    [
        ("xslF345X06/form4.xml", "form4.xml"),
        ("xslF345X05/nested/form4.xml", "nested/form4.xml"),
        ("xsl13F/informationtable.xml", "informationtable.xml"),
        ("form4.xml", "form4.xml"),
        ("  xslF345X06/form4.xml  ", "form4.xml"),
        ("", ""),
    ],
)
def test_raw_document_path_strips_only_the_xsl_view_prefix(primary, expected):
    assert raw_document_path(primary) == expected


def test_xsl_rendered_primary_document_resolves_to_the_raw_xml():
    """The submissions feed points at the XSL HTML view for most Form 4 filings.

    Fetching that path returns HTML, so the collector must resolve it to the raw
    ownership document beside it or every live Form 4 fails to parse.
    """
    submissions = {
        "name": "Apple Inc.",
        "tickers": ["AAPL"],
        "filings": {
            "recent": {
                "accessionNumber": ["0001140361-26-042149"],
                "form": ["4"],
                "filingDate": ["2026-11-05"],
                "acceptanceDateTime": ["2026-11-05T23:30:13.000Z"],
                "primaryDocument": ["xslF345X06/form4.xml"],
                "reportDate": ["2026-11-03"],
            }
        },
    }
    http = FakeHttp([FakeResponse(200, json.dumps(submissions).encode())])
    refs = _client(http).recent_filings("320193")

    assert len(refs) == 1
    assert refs[0].primary_document == "form4.xml"
    assert refs[0].source_url.endswith("/000114036126042149/form4.xml")


def test_filed_date_is_stored_separately_from_the_period_of_report(session):
    """A filing date is when the form was submitted, not the period it reports.

    Storing the period of report in ``filed_date`` makes the two
    indistinguishable, so the column must carry the filing date.
    """
    period = datetime(2024, 1, 15, tzinfo=UTC)
    client = FakeEdgarClient(
        documents={"0000320193-24-000001": form4_xml()},
        filings={
            "0000320193": [
                filing_ref("0000320193-24-000001", accepted_at=ACCEPTED, period=period)
            ]
        },
    )
    _ingestor(session, client).run(ciks=["0000320193"], since=WINDOW_START)

    filing = session.scalar(
        select(IntelFilingRow).where(
            IntelFilingRow.accession_number == "0000320193-24-000001"
        )
    )
    assert filing is not None
    assert filing.filed_date is not None
    assert filing.filed_date.date() == ACCEPTED.date()
    assert filing.period_of_report.date() == period.date()
    assert filing.filed_date.date() != filing.period_of_report.date()


def test_rate_limited_source_is_surfaced_as_an_error(session):
    client = FakeEdgarClient(
        fail_with=SourceRateLimited("slow down", retry_after_seconds=1.0), fail_times=1
    )
    result = _ingestor(session, client).run(ciks=["0000320193"], since=WINDOW_START)
    assert result.status == "failed"
    assert "slow down" in result.errors[0]["message"]
