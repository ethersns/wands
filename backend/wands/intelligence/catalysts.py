"""Catalyst Radar: verified upcoming and recently published market events.

The question this module answers is deliberately narrow: what important event is
approaching, when is it expected, what might it affect, and how reliable is that
information. It does not answer what a price will do, and nothing here can reach
the order path — the module imports no order, risk or strategy code.

Two kinds of catalyst are kept strictly apart:

* ``scheduled`` — a future event whose date a source publishes. Only the Federal
  Reserve's FOMC calendar is wired, because it is official, credential-free and
  states the meeting days it will hold.
* ``disclosure`` — an event that already happened and has since been published.
  These come from the SEC filings the intelligence collectors already store.

A disclosure is not a scheduled event. A Form 4 transaction date is when the
trade happened, not when it became public; a 13F period end is a quarter
boundary, not a filing release date. Both distinctions are carried in the payload
rather than flattened into a single "date" field, because a reader who cannot
tell them apart will draw the wrong conclusion from a correct record.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from enum import StrEnum
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from wands.config import Settings
from wands.db.models import (
    IntelFilingRow,
    IntelInstitutionRow,
    IntelInstitutionalHoldingRow,
)
from wands.intelligence.catalyst_sources import (
    STATUS_OK,
    ProviderResult,
    ScheduledCatalystProvider,
    ScheduledEvent,
    default_providers,
)
from wands.intelligence.schemas import (
    CatalystFeedOut,
    CatalystOut,
    CatalystSourceStatusOut,
)

DISCLOSURE_LIMIT = 100


class CatalystKind(StrEnum):
    SCHEDULED = "scheduled"
    DISCLOSURE = "disclosure"


class CatalystCategory(StrEnum):
    MONETARY_POLICY = "monetary_policy"
    EARNINGS = "earnings"
    ECONOMIC_RELEASE = "economic_release"
    INSIDER_DISCLOSURE = "insider_disclosure"
    INSTITUTIONAL_DISCLOSURE = "institutional_disclosure"


class TimePrecision(StrEnum):
    """How precisely the source stated the time.

    ``date_only`` is not a degraded ``exact``: it is a different claim. A source
    that published a day and no clock time has told us the day, and nothing more.
    """

    EXACT = "exact"
    APPROXIMATE = "approximate"
    DATE_ONLY = "date_only"
    UNCONFIRMED = "unconfirmed"


class CatalystStatus(StrEnum):
    SCHEDULED = "scheduled"
    CONFIRMED = "confirmed"
    TENTATIVE = "tentative"
    CANCELLED = "cancelled"
    POSTPONED = "postponed"
    PUBLISHED = "published"


CATALYST_CAVEATS = (
    "A catalyst is a scheduled or published event, not a forecast. Nothing here "
    "predicts the direction or size of a price move, and no catalyst is a trade "
    "recommendation.",
    "Each row names the source its date came from. Where a source publishes a day "
    "and no clock time, the row is marked date-only rather than given an invented "
    "time.",
)

COVERAGE_LIMITATIONS = (
    "Scheduled coverage is limited to the Federal Reserve's FOMC calendar. "
    "Earnings announcement dates and other macroeconomic releases are not "
    "collected because no licensed, credential-free source is configured.",
    "Disclosure catalysts are drawn from SEC filings already stored by the "
    "intelligence collectors. A symbol with no stored filing has no disclosure "
    "catalyst, which is a collection state and not evidence that nothing happened.",
)

FOMC_LIMITATION = (
    "The Federal Reserve publishes meeting days, not a release time. The decision "
    "is announced on the final day of the meeting; the source does not state a "
    "clock time, so none is shown."
)


def local_date(instant: datetime, time_zone: str) -> date:
    """The calendar date an instant falls on in a zone.

    A UTC instant near midnight is a different date in New York, and a daylight
    saving transition changes the offset, so this is a real conversion rather
    than a slice of the ISO string.
    """
    return instant.astimezone(ZoneInfo(time_zone)).date()


class CatalystService:
    """Reads scheduled and disclosure catalysts into one feed.

    The service never invents an event. When a scheduled source cannot be read,
    its status is reported alongside the feed so the caller can render a degraded
    source instead of an empty calendar.
    """

    def __init__(
        self,
        session: Session,
        settings: Settings,
        *,
        providers: list[ScheduledCatalystProvider] | None = None,
        now: datetime | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self._providers = providers
        self._now = now

    @property
    def now(self) -> datetime:
        return self._now or datetime.now(tz=UTC)

    def _provider_list(self) -> list[ScheduledCatalystProvider]:
        if self._providers is not None:
            return self._providers
        return default_providers(
            fomc_enabled=self.settings.catalyst_fomc_enabled,
            fomc_ttl_seconds=self.settings.catalyst_fomc_ttl_seconds,
            fomc_timeout_seconds=self.settings.catalyst_fomc_timeout_seconds,
            user_agent=self.settings.sec_user_agent,
        )

    def feed(
        self,
        *,
        category: str | None = None,
        symbol: str | None = None,
        window_days: int | None = None,
        past_days: int | None = None,
        limit: int | None = None,
    ) -> CatalystFeedOut:
        now = self.now
        today = now.astimezone(UTC).date()
        forward = window_days if window_days is not None else self.settings.catalyst_window_days
        backward = past_days if past_days is not None else self.settings.catalyst_past_days
        window_start = today - timedelta(days=max(backward, 0))
        window_end = today + timedelta(days=max(forward, 0))

        items: list[CatalystOut] = []
        sources: list[CatalystSourceStatusOut] = []

        for provider in self._provider_list():
            result = provider.fetch(now=now)
            sources.append(self._source_status(result))
            for event in result.events:
                if not (window_start <= event.event_date <= window_end):
                    continue
                items.append(self._scheduled_catalyst(event, result, now))

        items.extend(self._insider_disclosures(window_start, window_end))
        items.extend(self._institutional_disclosures(window_start, window_end))

        caveats = list(CATALYST_CAVEATS)
        limitations = list(COVERAGE_LIMITATIONS)

        if category:
            items = [item for item in items if item.category == category]

        if symbol:
            canonical = symbol.strip().upper()
            market_wide = [item for item in items if item.market_wide]
            items = [item for item in items if canonical in item.symbols]
            if market_wide:
                caveats.append(
                    f"{len(market_wide)} market-wide event(s) are hidden while a "
                    "symbol filter is active, because they are not tagged to any "
                    "single symbol."
                )

        upcoming = sorted(
            (item for item in items if self._anchor_date(item) >= today),
            key=lambda item: self._anchor_date(item),
        )
        recent = sorted(
            (item for item in items if self._anchor_date(item) < today),
            key=lambda item: self._anchor_date(item),
            reverse=True,
        )

        cap = limit if limit is not None else self.settings.catalyst_max_items
        ordered = (upcoming + recent)[: max(cap, 0)]

        # Counted after the cap so the totals always describe the items actually
        # returned. A count that exceeds the list it summarises is a bug a reader
        # would see as a missing row.
        returned_upcoming = sum(1 for item in ordered if self._anchor_date(item) >= today)

        return CatalystFeedOut(
            items=ordered,
            sources=sources,
            window_start=window_start,
            window_end=window_end,
            upcoming=returned_upcoming,
            recent=len(ordered) - returned_upcoming,
            caveats=caveats,
            coverage_limitations=limitations,
        )

    # -- scheduled ------------------------------------------------------

    def _source_status(self, result: ProviderResult) -> CatalystSourceStatusOut:
        return CatalystSourceStatusOut(
            source=result.source,
            label=result.label,
            status=result.status,
            detail=result.detail,
            event_count=len(result.events),
            source_url=result.source_url,
            fetched_at=result.fetched_at,
        )

    def _scheduled_catalyst(
        self, event: ScheduledEvent, result: ProviderResult, now: datetime
    ) -> CatalystOut:
        warnings: list[str] = []
        if event.date_derived:
            warnings.append(
                "The decision date is derived from the meeting range the Federal "
                "Reserve published. The source has not yet published a statement "
                "for this meeting."
            )

        return CatalystOut(
            id=event.source_id,
            kind=CatalystKind.SCHEDULED,
            category=CatalystCategory.MONETARY_POLICY,
            title=event.title,
            symbols=[],
            market="US",
            market_wide=True,
            scheduled_date=event.event_date,
            scheduled_at=None,
            time_precision=TimePrecision.DATE_ONLY,
            time_zone=event.time_zone,
            status=(
                event.status
                if event.status != CatalystStatus.SCHEDULED
                else (
                    CatalystStatus.SCHEDULED
                    if event.date_derived
                    else CatalystStatus.CONFIRMED
                )
            ),
            occurred_at=None,
            published_at=None,
            source_name=event.source_name,
            source_url=event.source_url,
            source_updated_at=None,
            collected_at=result.fetched_at or now,
            warnings=warnings,
            coverage_limitations=[FOMC_LIMITATION],
        )

    # -- disclosures ----------------------------------------------------

    def _insider_disclosures(self, window_start: date, window_end: date) -> list[CatalystOut]:
        since = datetime.combine(window_start, time.min, tzinfo=UTC)
        until = datetime.combine(window_end, time.max, tzinfo=UTC)

        rows = self.session.scalars(
            select(IntelFilingRow)
            .where(
                or_(
                    IntelFilingRow.form_type.like("3%"),
                    IntelFilingRow.form_type.like("4%"),
                    IntelFilingRow.form_type.like("5%"),
                )
            )
            .where(IntelFilingRow.accepted_at >= since)
            .where(IntelFilingRow.accepted_at <= until)
            .order_by(IntelFilingRow.accepted_at.desc())
            .limit(DISCLOSURE_LIMIT)
        ).all()

        catalysts: list[CatalystOut] = []
        for row in rows:
            symbol = (row.symbol or "").strip().upper()
            issuer = (row.issuer_name or "").strip() or symbol or "Unknown issuer"
            form = (row.form_type or "").strip() or "filing"
            warnings: list[str] = []
            if row.is_amendment:
                warnings.append(
                    "This is an amendment. It restates an earlier filing and does "
                    "not describe a new transaction."
                )

            catalysts.append(
                CatalystOut(
                    id=f"sec:form{form}:{row.accession_number}",
                    kind=CatalystKind.DISCLOSURE,
                    category=CatalystCategory.INSIDER_DISCLOSURE,
                    title=f"{issuer} filed Form {form} insider disclosure",
                    symbols=[symbol] if symbol else [],
                    market="US",
                    market_wide=False,
                    scheduled_date=None,
                    scheduled_at=None,
                    time_precision=TimePrecision.EXACT,
                    time_zone="UTC",
                    status=CatalystStatus.PUBLISHED,
                    occurred_at=row.period_of_report,
                    published_at=row.accepted_at,
                    source_name="SEC EDGAR",
                    source_url=row.source_url or "",
                    source_updated_at=None,
                    collected_at=row.ingested_at,
                    warnings=warnings,
                    coverage_limitations=[
                        "The transaction date is when the reported trade happened. "
                        "The filing became public on the acceptance timestamp shown, "
                        "and only that timestamp was knowable at the time."
                    ],
                )
            )
        return catalysts

    def _institutional_disclosures(
        self, window_start: date, window_end: date
    ) -> list[CatalystOut]:
        since = datetime.combine(window_start, time.min, tzinfo=UTC)
        until = datetime.combine(window_end, time.max, tzinfo=UTC)

        rows = self.session.execute(
            select(
                IntelInstitutionalHoldingRow.accession_number,
                IntelInstitutionalHoldingRow.accepted_at,
                IntelInstitutionalHoldingRow.period_of_report,
                IntelInstitutionalHoldingRow.source_url,
                IntelInstitutionRow.name,
                func.count(IntelInstitutionalHoldingRow.id),
                func.max(IntelInstitutionalHoldingRow.ingested_at),
            )
            .join(
                IntelInstitutionRow,
                IntelInstitutionRow.id == IntelInstitutionalHoldingRow.institution_id,
            )
            .where(IntelInstitutionalHoldingRow.accepted_at >= since)
            .where(IntelInstitutionalHoldingRow.accepted_at <= until)
            .group_by(
                IntelInstitutionalHoldingRow.accession_number,
                IntelInstitutionalHoldingRow.accepted_at,
                IntelInstitutionalHoldingRow.period_of_report,
                IntelInstitutionalHoldingRow.source_url,
                IntelInstitutionRow.name,
            )
            .order_by(IntelInstitutionalHoldingRow.accepted_at.desc())
            .limit(DISCLOSURE_LIMIT)
        ).all()

        catalysts: list[CatalystOut] = []
        for accession, accepted_at, period, source_url, name, positions, ingested in rows:
            institution = (name or "").strip() or "Unknown institution"
            period_label = period.date().isoformat() if period else "an unstated period"
            catalysts.append(
                CatalystOut(
                    id=f"sec:13f:{accession}",
                    kind=CatalystKind.DISCLOSURE,
                    category=CatalystCategory.INSTITUTIONAL_DISCLOSURE,
                    title=f"{institution} filed Form 13F for the quarter ending {period_label}",
                    symbols=[],
                    market="US",
                    market_wide=False,
                    scheduled_date=None,
                    scheduled_at=None,
                    time_precision=TimePrecision.EXACT,
                    time_zone="UTC",
                    status=CatalystStatus.PUBLISHED,
                    occurred_at=period,
                    published_at=accepted_at,
                    source_name="SEC EDGAR",
                    source_url=source_url or "",
                    source_updated_at=None,
                    collected_at=ingested or accepted_at,
                    warnings=[
                        f"This filing reports {positions} position(s). Positions are "
                        "not resolved to tickers in this view."
                    ],
                    coverage_limitations=[
                        "The quarter end is the reporting period, not a filing "
                        "release date. A 13F is filed up to 45 days after the "
                        "quarter ends, and the acceptance timestamp is when it "
                        "became public."
                    ],
                )
            )
        return catalysts

    # -- ordering -------------------------------------------------------

    def _anchor_date(self, catalyst: CatalystOut) -> date:
        """The date a catalyst is placed on in the feed.

        A scheduled event is placed on its scheduled date. A disclosure is placed
        on the day it became public, because that is the day it became knowable.
        """
        if catalyst.scheduled_date is not None:
            return catalyst.scheduled_date
        if catalyst.published_at is not None:
            return local_date(catalyst.published_at, catalyst.time_zone)
        if catalyst.occurred_at is not None:
            return local_date(catalyst.occurred_at, catalyst.time_zone)
        return date.min


__all__ = [
    "CATALYST_CAVEATS",
    "COVERAGE_LIMITATIONS",
    "CatalystCategory",
    "CatalystKind",
    "CatalystService",
    "CatalystStatus",
    "STATUS_OK",
    "TimePrecision",
    "local_date",
]
