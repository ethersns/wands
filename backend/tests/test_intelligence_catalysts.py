"""Catalyst Radar: source integrity, time integrity and honest failure.

The claims under test are all of the form "this row says exactly what the source
said, and nothing more". That is why the fixtures are hand-built documents rather
than live responses: a test that reached the Federal Reserve would prove the
network works, not that the parser refuses to invent a time.

No test here touches the network. Every provider is either a fake or is given a
fake HTTP client, so a suite run cannot depend on a government site being up.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, date, datetime, timedelta

import httpx
import pytest

from wands.config import get_settings
from wands.db.models import (
    ApiKey,
    IntelFilingRow,
    IntelInstitutionRow,
    IntelInstitutionalHoldingRow,
    User,
)
from wands.db.session import session_scope
from wands.intelligence.catalyst_sources import (
    STATUS_FAILED,
    STATUS_OK,
    STATUS_UNAVAILABLE,
    FomcCalendarProvider,
    ProviderResult,
    ScheduledEvent,
    parse_fomc_calendar,
    reset_cache,
)
from wands.intelligence.catalysts import CatalystService, local_date
from wands.security.auth import generate_api_key

from .conftest import PEPPER

NOW = datetime(2026, 11, 9, 15, 0, tzinfo=UTC)

# Mirrors the real page: a year panel, a meeting with a statement, a future
# meeting without one, a cross-month range, a footnote asterisk, and an
# out-of-cycle notation vote.
FOMC_FIXTURE = """
<div class="panel panel-default"><div class="panel-heading">
  <h4><a id="42828">2026 FOMC Meetings</a></h4></div>
  <div class="row fomc-meeting" ">
    <div class="fomc-meeting__month col-xs-5"><strong>January</strong></div>
    <div class="fomc-meeting__date col-xs-4">27-28</div>
    <div class="col-xs-12"><a href="/newsevents/pressreleases/monetary20260128a.htm">HTML</a></div>
  </div>
  <div class="row fomc-meeting" ">
    <div class="fomc-meeting__month col-xs-5"><strong>March</strong></div>
    <div class="fomc-meeting__date col-xs-4">17-18*</div>
    <div class="col-xs-12"></div>
  </div>
  <div class="row fomc-meeting" ">
    <div class="fomc-meeting__month col-xs-5"><strong>Apr/May</strong></div>
    <div class="fomc-meeting__date col-xs-4">30-1</div>
    <div class="col-xs-12"></div>
  </div>
  <div class="row fomc-meeting" ">
    <div class="fomc-meeting__month col-xs-5"><strong>August</strong></div>
    <div class="fomc-meeting__date col-xs-4">22 (notation vote)</div>
    <div class="col-xs-12"><a href="/newsevents/pressreleases/monetary20260822a.htm">HTML</a></div>
  </div>
</div>
"""

EMPTY_PAGE = """
<div class="panel panel-default"><div class="panel-heading">
  <h4><a id="1">2026 FOMC Meetings</a></h4></div>
</div>
"""


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


class FakeProvider:
    """A provider that returns a prepared result and records that it was asked."""

    source = "fake_source"
    label = "Fake source"

    def __init__(self, result: ProviderResult) -> None:
        self._result = result
        self.calls = 0

    def fetch(self, *, now: datetime) -> ProviderResult:
        self.calls += 1
        return self._result


def _ok(events: list[ScheduledEvent]) -> ProviderResult:
    return ProviderResult(
        source="fake_source",
        label="Fake source",
        status=STATUS_OK,
        detail="ok",
        events=tuple(events),
        source_url="https://example.gov/calendar",
        fetched_at=NOW,
    )


def _failed(detail: str = "The source could not be reached.") -> ProviderResult:
    return ProviderResult(
        source="fake_source",
        label="Fake source",
        status=STATUS_FAILED,
        detail=detail,
        events=(),
        source_url="https://example.gov/calendar",
        fetched_at=NOW,
    )


def _event(
    event_date: date,
    *,
    source_id: str | None = None,
    derived: bool = False,
    status: str = "scheduled",
) -> ScheduledEvent:
    return ScheduledEvent(
        source_id=source_id or f"fed:fomc:{event_date.isoformat()}",
        title="FOMC policy decision",
        event_date=event_date,
        time_zone="America/New_York",
        source_url="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        source_name="Federal Reserve FOMC calendar",
        date_derived=derived,
        detail="Meeting held.",
        status=status,
    )


def _filing(
    session,
    *,
    accession: str,
    symbol: str = "AAPL",
    form_type: str = "4",
    accepted_at: datetime,
    period_of_report: datetime | None = None,
    ingested_at: datetime | None = None,
    is_amendment: bool = False,
) -> IntelFilingRow:
    row = IntelFilingRow(
        accession_number=accession,
        form_type=form_type,
        document_type="xml",
        issuer_cik="0000320193",
        issuer_name="Apple Inc.",
        symbol=symbol,
        period_of_report=period_of_report or accepted_at - timedelta(days=2),
        filed_date=accepted_at,
        accepted_at=accepted_at,
        source_url=f"https://www.sec.gov/Archives/edgar/data/320193/{accession}",
        source="sec_edgar",
        is_amendment=is_amendment,
        raw_sha256="0" * 64,
        ingested_at=ingested_at or accepted_at,
    )
    session.add(row)
    session.flush()
    return row


def _holding(session, *, accession: str, accepted_at: datetime, period: datetime) -> None:
    institution = IntelInstitutionRow(cik=f"000{os.urandom(2).hex()}", name="Test Capital LP")
    session.add(institution)
    session.flush()
    session.add(
        IntelInstitutionalHoldingRow(
            institution_id=institution.id,
            accession_number=accession,
            ordinal=0,
            period_of_report=period,
            filed_date=accepted_at,
            accepted_at=accepted_at,
            cusip="037833100",
            issuer_name="Apple Inc.",
            value_usd=1000,
            shares=10,
            source_url=f"https://www.sec.gov/Archives/edgar/data/1/{accession}",
            ingested_at=accepted_at,
        )
    )
    session.flush()


def _key_with_scopes(scopes: list[str]) -> dict[str, str]:
    with session_scope() as session:
        user = User(
            email=f"catalyst-{os.urandom(3).hex()}@test.local",
            display_name="Catalyst",
            role="viewer",
            mfa_enabled=False,
            is_active=True,
        )
        session.add(user)
        session.flush()
        full, prefix, hashed = generate_api_key(PEPPER)
        session.add(
            ApiKey(
                user_id=user.id,
                name="catalyst key",
                key_prefix=prefix,
                key_hash=hashed,
                role="viewer",
                scopes=scopes,
            )
        )
        session.flush()
    return {"authorization": f"Bearer {full}"}


@pytest.fixture(autouse=True)
def clear_provider_cache():
    reset_cache()
    yield
    reset_cache()


# --------------------------------------------------------------------------
# Parsing: what the source said, and nothing more
# --------------------------------------------------------------------------


def test_a_statement_date_is_preferred_over_the_meeting_range():
    events = parse_fomc_calendar(FOMC_FIXTURE)
    january = next(event for event in events if event.event_date.month == 1)

    assert january.event_date == date(2026, 1, 28)
    assert january.date_derived is False


def test_a_future_meeting_without_a_statement_is_marked_derived():
    events = parse_fomc_calendar(FOMC_FIXTURE)
    march = next(event for event in events if event.event_date.month == 3)

    assert march.event_date == date(2026, 3, 18)
    assert march.date_derived is True


def test_a_cross_month_range_resolves_to_the_second_month():
    events = parse_fomc_calendar(FOMC_FIXTURE)
    may = next(event for event in events if event.event_date.month == 5)

    assert may.event_date == date(2026, 5, 1)


def test_a_footnote_asterisk_does_not_corrupt_the_date():
    events = parse_fomc_calendar(FOMC_FIXTURE)
    assert all(event.event_date.day != 0 for event in events)
    assert date(2026, 3, 18) in {event.event_date for event in events}


def test_an_out_of_cycle_notation_vote_is_not_listed_as_a_meeting():
    events = parse_fomc_calendar(FOMC_FIXTURE)
    assert date(2026, 8, 22) not in {event.event_date for event in events}


def test_every_event_carries_an_absolute_source_url():
    for event in parse_fomc_calendar(FOMC_FIXTURE):
        assert event.source_url.startswith("https://")
        assert event.source_name


def test_a_page_with_no_meeting_rows_parses_to_nothing():
    assert parse_fomc_calendar(EMPTY_PAGE) == []


# --------------------------------------------------------------------------
# Provider: a source that cannot be read is not an empty calendar
# --------------------------------------------------------------------------


def test_a_disabled_source_reports_unavailable_rather_than_empty(monkeypatch):
    provider = FomcCalendarProvider(enabled=False)
    result = provider.fetch(now=NOW)

    assert result.status == STATUS_UNAVAILABLE
    assert result.events == ()
    assert "disabled" in result.detail.lower()


def test_a_network_failure_is_reported_as_failed(monkeypatch):
    class BrokenClient:
        def __init__(self, **kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args) -> None:
            return None

        def get(self, url):
            raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx, "Client", BrokenClient)

    result = FomcCalendarProvider().fetch(now=NOW)

    assert result.status == STATUS_FAILED
    assert result.events == ()
    assert "could not be reached" in result.detail


def test_an_http_error_is_reported_as_failed(monkeypatch):
    request = httpx.Request("GET", "https://www.federalreserve.gov/")

    class ErrorClient:
        def __init__(self, **kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args) -> None:
            return None

        def get(self, url):
            return httpx.Response(503, request=request, text="unavailable")

    monkeypatch.setattr(httpx, "Client", ErrorClient)

    result = FomcCalendarProvider().fetch(now=NOW)

    assert result.status == STATUS_FAILED
    assert "503" in result.detail


def test_a_page_that_parses_to_nothing_is_a_failure_not_an_empty_calendar(monkeypatch):
    request = httpx.Request("GET", "https://www.federalreserve.gov/")

    class EmptyClient:
        def __init__(self, **kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args) -> None:
            return None

        def get(self, url):
            return httpx.Response(200, request=request, text=EMPTY_PAGE)

    monkeypatch.setattr(httpx, "Client", EmptyClient)

    result = FomcCalendarProvider().fetch(now=NOW)

    assert result.status == STATUS_FAILED
    assert "no meeting rows" in result.detail


def test_a_successful_fetch_is_cached_within_the_ttl(monkeypatch):
    request = httpx.Request("GET", "https://www.federalreserve.gov/")
    calls = {"count": 0}

    class CountingClient:
        def __init__(self, **kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args) -> None:
            return None

        def get(self, url):
            calls["count"] += 1
            return httpx.Response(200, request=request, text=FOMC_FIXTURE)

    monkeypatch.setattr(httpx, "Client", CountingClient)

    provider = FomcCalendarProvider(ttl_seconds=3600)
    first = provider.fetch(now=NOW)
    second = provider.fetch(now=NOW)

    assert first.status == STATUS_OK
    assert second.status == STATUS_OK
    assert calls["count"] == 1


# --------------------------------------------------------------------------
# Service: scheduled catalysts
# --------------------------------------------------------------------------


def test_a_scheduled_catalyst_has_a_date_and_no_invented_time(session):
    provider = FakeProvider(_ok([_event(date(2027, 1, 27), derived=True)]))
    feed = CatalystService(session, get_settings(), providers=[provider], now=NOW).feed()

    item = next(item for item in feed.items if item.kind == "scheduled")

    assert item.scheduled_date == date(2027, 1, 27)
    assert item.scheduled_at is None
    assert item.time_precision == "date_only"
    assert item.time_zone == "America/New_York"
    assert item.status == "scheduled"
    assert item.market_wide is True
    assert item.symbols == []


def test_a_statement_backed_meeting_is_confirmed(session):
    provider = FakeProvider(_ok([_event(date(2026, 11, 4), derived=False)]))
    feed = CatalystService(session, get_settings(), providers=[provider], now=NOW).feed()

    item = next(item for item in feed.items if item.kind == "scheduled")
    assert item.status == "confirmed"


def test_a_cancelled_event_keeps_the_status_the_source_reported(session):
    provider = FakeProvider(
        _ok([_event(date(2027, 3, 17), derived=True, status="cancelled")])
    )
    feed = CatalystService(session, get_settings(), providers=[provider], now=NOW).feed(
        window_days=365
    )

    item = next(item for item in feed.items if item.kind == "scheduled")
    assert item.status == "cancelled"


def test_a_failed_source_is_reported_alongside_the_feed(session):
    provider = FakeProvider(_failed())
    feed = CatalystService(session, get_settings(), providers=[provider], now=NOW).feed()

    assert feed.sources[0].status == STATUS_FAILED
    assert feed.sources[0].event_count == 0
    assert feed.items == []


def test_events_outside_the_window_are_excluded(session):
    provider = FakeProvider(
        _ok([_event(date(2027, 1, 27)), _event(date(2030, 1, 1))])
    )
    feed = CatalystService(session, get_settings(), providers=[provider], now=NOW).feed(
        window_days=90
    )

    dates = {item.scheduled_date for item in feed.items if item.kind == "scheduled"}
    assert date(2027, 1, 27) in dates
    assert date(2030, 1, 1) not in dates


# --------------------------------------------------------------------------
# Service: disclosures keep the five timestamps apart
# --------------------------------------------------------------------------


def test_a_disclosure_uses_the_publication_time_not_the_transaction_date(session):
    accepted = datetime(2026, 11, 5, 21, 30, tzinfo=UTC)
    traded = datetime(2026, 11, 3, 15, 0, tzinfo=UTC)
    _filing(session, accession="0001-26-000001", accepted_at=accepted, period_of_report=traded)
    session.commit()

    feed = CatalystService(session, get_settings(), providers=[], now=NOW).feed()
    item = next(item for item in feed.items if item.category == "insider_disclosure")

    assert item.published_at == accepted
    assert item.occurred_at == traded
    assert item.published_at != item.occurred_at
    assert item.status == "published"
    assert item.symbols == ["AAPL"]


def test_a_disclosure_reports_collection_lag_rather_than_hiding_it(session):
    accepted = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
    collected = datetime(2026, 11, 8, 12, 0, tzinfo=UTC)
    _filing(session, accession="0001-26-000002", accepted_at=accepted, ingested_at=collected)
    session.commit()

    feed = CatalystService(session, get_settings(), providers=[], now=NOW).feed()
    item = next(item for item in feed.items if item.category == "insider_disclosure")

    assert item.published_at == accepted
    assert item.collected_at == collected
    assert item.collected_at > item.published_at


def test_duplicate_filings_are_deduplicated_by_accession(session):
    accepted = datetime(2026, 11, 5, 21, 30, tzinfo=UTC)
    _filing(session, accession="0001-26-000003", accepted_at=accepted)
    session.commit()

    feed = CatalystService(session, get_settings(), providers=[], now=NOW).feed()
    ids = [item.id for item in feed.items if item.category == "insider_disclosure"]

    assert len(ids) == len(set(ids))
    assert ids == ["sec:form4:0001-26-000003"]


def test_an_amendment_is_flagged_as_restating_an_earlier_filing(session):
    accepted = datetime(2026, 11, 5, 21, 30, tzinfo=UTC)
    _filing(session, accession="0001-26-000004", accepted_at=accepted, is_amendment=True)
    session.commit()

    feed = CatalystService(session, get_settings(), providers=[], now=NOW).feed()
    item = next(item for item in feed.items if item.category == "insider_disclosure")

    assert any("amendment" in warning.lower() for warning in item.warnings)


def test_a_13f_period_end_is_not_presented_as_a_release_date(session):
    accepted = datetime(2026, 11, 6, 14, 0, tzinfo=UTC)
    period = datetime(2026, 9, 30, 0, 0, tzinfo=UTC)
    _holding(session, accession="0002-26-000001", accepted_at=accepted, period=period)
    session.commit()

    feed = CatalystService(session, get_settings(), providers=[], now=NOW).feed()
    item = next(item for item in feed.items if item.category == "institutional_disclosure")

    assert item.occurred_at == period
    assert item.published_at == accepted
    assert item.scheduled_date is None
    assert any("reporting period" in note for note in item.coverage_limitations)


def test_a_symbol_filter_hides_market_wide_events_and_says_so(session):
    accepted = datetime(2026, 11, 5, 21, 30, tzinfo=UTC)
    _filing(session, accession="0001-26-000005", accepted_at=accepted)
    session.commit()

    provider = FakeProvider(_ok([_event(date(2027, 1, 27), derived=True)]))
    feed = CatalystService(session, get_settings(), providers=[provider], now=NOW).feed(
        symbol="AAPL"
    )

    assert all(item.market_wide is False for item in feed.items)
    assert any("market-wide" in caveat for caveat in feed.caveats)


def test_a_category_filter_returns_only_that_category(session):
    accepted = datetime(2026, 11, 5, 21, 30, tzinfo=UTC)
    _filing(session, accession="0001-26-000006", accepted_at=accepted)
    session.commit()

    provider = FakeProvider(_ok([_event(date(2027, 1, 27), derived=True)]))
    feed = CatalystService(session, get_settings(), providers=[provider], now=NOW).feed(
        category="monetary_policy"
    )

    assert feed.items
    assert {item.category for item in feed.items} == {"monetary_policy"}


# --------------------------------------------------------------------------
# Time zones and daylight saving
# --------------------------------------------------------------------------


def test_local_date_converts_across_the_spring_dst_boundary():
    # 06:30Z is 01:30 EST; 07:30Z is 03:30 EDT. Both are the same calendar day.
    assert local_date(datetime(2026, 3, 8, 6, 30, tzinfo=UTC), "America/New_York") == date(
        2026, 3, 8
    )
    assert local_date(datetime(2026, 3, 8, 7, 30, tzinfo=UTC), "America/New_York") == date(
        2026, 3, 8
    )


def test_local_date_converts_across_the_autumn_dst_boundary():
    # 05:30Z is 01:30 EDT; 06:30Z is 01:30 EST. The offset changed, the day did not.
    assert local_date(datetime(2026, 11, 1, 5, 30, tzinfo=UTC), "America/New_York") == date(
        2026, 11, 1
    )
    assert local_date(datetime(2026, 11, 1, 6, 30, tzinfo=UTC), "America/New_York") == date(
        2026, 11, 1
    )


def test_a_late_utc_instant_falls_on_the_previous_day_in_new_york():
    # 02:00Z on 5 November is 22:00 on 4 November in New York.
    assert local_date(datetime(2026, 11, 5, 2, 0, tzinfo=UTC), "America/New_York") == date(
        2026, 11, 4
    )


# --------------------------------------------------------------------------
# API: permissions and envelope
# --------------------------------------------------------------------------


def test_the_catalyst_endpoint_requires_a_token(client):
    response = client.get("/v1/intelligence/catalysts")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_a_credential_without_the_research_scope_is_denied(client):
    headers = _key_with_scopes(["orders:read", "portfolio:read"])
    response = client.get("/v1/intelligence/catalysts", headers=headers)

    assert response.status_code == 403
    assert "research:read" in response.json()["error"]["message"]


def test_a_research_credential_receives_the_catalyst_envelope(client, monkeypatch):
    provider = FakeProvider(_ok([_event(date(2027, 1, 27), derived=True)]))
    monkeypatch.setattr(
        "wands.intelligence.catalysts.default_providers", lambda **kwargs: [provider]
    )

    headers = _key_with_scopes(["research:read"])
    response = client.get("/v1/intelligence/catalysts", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["provenance"] == "live"
    assert body["data"]["items"]
    assert body["data"]["sources"][0]["status"] == STATUS_OK
    assert body["data"]["windowStart"] <= body["data"]["windowEnd"]

    item = body["data"]["items"][0]
    assert item["scheduledDate"] == "2027-01-27"
    assert item["scheduledAt"] is None
    assert item["timePrecision"] == "date_only"


def test_the_endpoint_is_unavailable_when_every_source_fails(client, monkeypatch):
    provider = FakeProvider(_failed("The source could not be reached."))
    monkeypatch.setattr(
        "wands.intelligence.catalysts.default_providers", lambda **kwargs: [provider]
    )

    headers = _key_with_scopes(["research:read"])
    response = client.get("/v1/intelligence/catalysts", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["provenance"] == "unavailable"
    assert body["data"]["items"] == []
    assert any("could not be reached" in warning for warning in body["warnings"])


def test_an_empty_window_is_not_reported_as_an_unavailable_source(client, monkeypatch):
    provider = FakeProvider(_ok([]))
    monkeypatch.setattr(
        "wands.intelligence.catalysts.default_providers", lambda **kwargs: [provider]
    )

    headers = _key_with_scopes(["research:read"])
    response = client.get("/v1/intelligence/catalysts", headers=headers)

    body = response.json()
    assert body["provenance"] == "live"
    assert body["data"]["sources"][0]["status"] == STATUS_OK
    assert any("empty window" in warning for warning in body["warnings"])
