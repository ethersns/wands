"""Scheduled catalyst sources.

A scheduled catalyst is a future market event whose date a source publishes. The
only source wired here is the Federal Reserve's own FOMC calendar, because it is
official, credential-free, and states the meeting dates it will hold.

Three rules shape this module:

* A date the source publishes is a date, not a time. The Fed publishes meeting
  days and never a release time, so every event here is ``date_only``. Turning
  "27-28 January" into "14:00 New York" would be an invention, and an invented
  time is indistinguishable from a real one once it reaches a screen.
* A source that cannot be read is not an empty calendar. Every failure path
  returns a status the caller must render, so a member never sees "no events"
  when the truth is "we could not ask".
* The fetch is bounded. One small public page, cached for hours, with a hard
  timeout and a single attempt per window. There is no polling worker here.

Sources that were evaluated and rejected are recorded in
``docs/feature-inventory.md`` rather than half-wired: BLS blocks automated
requests, and FRED and every earnings-calendar vendor require a credential the
operator has not issued.
"""

from __future__ import annotations

import re
import threading
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime
from html.parser import HTMLParser
from typing import Protocol

import httpx

FOMC_CALENDAR_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
FOMC_SOURCE_NAME = "Federal Reserve FOMC calendar"
FOMC_SOURCE_KEY = "fed_fomc"
FOMC_TIME_ZONE = "America/New_York"

STATUS_OK = "ok"
STATUS_UNAVAILABLE = "unavailable"
STATUS_FAILED = "failed"

_MONTHS = {
    name: index
    for index, name in enumerate(
        (
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ),
        start=1,
    )
}


@dataclass(frozen=True)
class ScheduledEvent:
    """One event a provider asserts is scheduled.

    ``event_date`` is a calendar date in ``time_zone``. It is deliberately not a
    ``datetime``: the source never published a time, and a ``datetime`` would
    invite a caller to read a precision that does not exist.
    """

    source_id: str
    title: str
    event_date: date
    time_zone: str
    source_url: str
    source_name: str
    # True when the date was derived from a published meeting range because the
    # source has not yet published a statement for that meeting.
    date_derived: bool
    detail: str
    # What the source says about the event's standing. A source that cancels or
    # postpones a meeting must be able to say so, so the status travels with the
    # event rather than being assumed to be "scheduled".
    status: str = "scheduled"


@dataclass(frozen=True)
class ProviderResult:
    """What one provider could say, including when it could say nothing."""

    source: str
    label: str
    status: str
    detail: str
    events: tuple[ScheduledEvent, ...]
    source_url: str | None
    fetched_at: datetime | None


class ScheduledCatalystProvider(Protocol):
    source: str
    label: str

    def fetch(self, *, now: datetime) -> ProviderResult: ...


class _FomcCalendarParser(HTMLParser):
    """Reads the Fed's FOMC calendar page.

    The page is a sequence of year panels, each holding ``div.row.fomc-meeting``
    blocks with a month cell, a day-range cell and (once a meeting has happened)
    a link to the statement. The statement filename carries the authoritative
    decision date, so it is preferred whenever it exists.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.year: int | None = None
        self._depth = 0
        self._meeting: dict[str, str | None] | None = None
        self._meeting_depth: int | None = None
        self._capture: str | None = None
        self._buffer: list[str] = []
        self._in_heading = False
        self._heading: list[str] = []
        self.rows: list[tuple[int | None, dict[str, str | None]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        classes = attributes.get("class") or ""

        if tag == "div":
            self._depth += 1
            if "fomc-meeting" in classes and "row" in classes and self._meeting is None:
                self._meeting = {"month": None, "date": None, "statement": None}
                self._meeting_depth = self._depth
            elif self._meeting is not None:
                if "fomc-meeting__month" in classes:
                    self._capture = "month"
                    self._buffer = []
                elif "fomc-meeting__date" in classes:
                    self._capture = "date"
                    self._buffer = []

        if tag == "h4":
            self._in_heading = True
            self._heading = []

        if tag == "a" and self._meeting is not None:
            href = attributes.get("href") or ""
            match = re.search(r"monetary(\d{8})a\.htm", href)
            if match and not self._meeting["statement"]:
                self._meeting["statement"] = match.group(1)

    def handle_endtag(self, tag: str) -> None:
        if tag == "div":
            if self._capture is not None and self._meeting is not None:
                self._meeting[self._capture] = "".join(self._buffer).strip()
                self._capture = None
            if self._meeting is not None and self._depth == self._meeting_depth:
                self.rows.append((self.year, self._meeting))
                self._meeting = None
                self._meeting_depth = None
            self._depth -= 1

        if tag == "h4":
            self._in_heading = False
            match = re.search(r"(\d{4})\s+FOMC Meetings", "".join(self._heading))
            if match:
                self.year = int(match.group(1))

    def handle_data(self, data: str) -> None:
        if self._capture is not None:
            self._buffer.append(data)
        if self._in_heading:
            self._heading.append(data)


def _decision_date(
    year: int, month_text: str, date_text: str, statement: str | None
) -> tuple[date | None, bool]:
    """Resolve the decision date for one meeting row.

    Returns the date and whether it was derived from the meeting range. The
    statement filename wins when present because it is the Fed's own record of
    the day the decision was published.
    """
    if statement:
        return date(int(statement[:4]), int(statement[4:6]), int(statement[6:])), False

    months = [
        _MONTHS[part.strip()]
        for part in month_text.split("/")
        if part.strip() in _MONTHS
    ]
    days = [int(value) for value in re.findall(r"\d+", date_text)]
    if not months or not days:
        return None, True

    if len(days) == 1:
        return date(year, months[0], days[0]), True

    start, end = days[0], days[-1]
    # A range that wraps ("Apr/May 30-1") ends in the second month.
    month = months[1] if len(months) > 1 and end < start else months[0]
    try:
        return date(year, month, end), True
    except ValueError:
        return None, True


def parse_fomc_calendar(
    html: str, *, source_url: str = FOMC_CALENDAR_URL
) -> list[ScheduledEvent]:
    """Parse the Fed's FOMC calendar into scheduled events.

    Out-of-cycle notation votes are excluded: they are procedural actions, not
    scheduled policy meetings, and listing one as a rate decision would misstate
    what the source says.
    """
    parser = _FomcCalendarParser()
    parser.feed(html)

    events: list[ScheduledEvent] = []
    for year, row in parser.rows:
        if year is None:
            continue
        month_text = (row.get("month") or "").strip()
        date_text = (row.get("date") or "").strip()
        if not month_text or not date_text:
            continue
        if "notation" in date_text.lower():
            continue

        resolved, derived = _decision_date(year, month_text, date_text, row.get("statement"))
        if resolved is None:
            continue

        events.append(
            ScheduledEvent(
                source_id=f"fed:fomc:{resolved.isoformat()}",
                title="FOMC policy decision",
                event_date=resolved,
                time_zone=FOMC_TIME_ZONE,
                source_url=source_url,
                source_name=FOMC_SOURCE_NAME,
                date_derived=derived,
                detail=(
                    f"Meeting held {month_text} {date_text.replace('*', '').strip()}, "
                    f"{year}."
                ),
            )
        )

    events.sort(key=lambda event: event.event_date)
    return events


@dataclass
class _CacheEntry:
    stored_at: float
    result: ProviderResult


_CACHE: dict[str, _CacheEntry] = {}
_CACHE_LOCK = threading.Lock()


def reset_cache() -> None:
    """Drop the cached provider results. Used by tests and by the CLI."""
    with _CACHE_LOCK:
        _CACHE.clear()


class FomcCalendarProvider:
    """The Federal Reserve's published FOMC meeting calendar.

    The page is fetched at most once per ``ttl_seconds`` and never more than once
    per process at a time. A failed fetch is cached too, so a source that is down
    is not retried on every member request.
    """

    source = FOMC_SOURCE_KEY
    label = FOMC_SOURCE_NAME

    def __init__(
        self,
        *,
        enabled: bool = True,
        ttl_seconds: int = 21600,
        timeout_seconds: float = 10.0,
        user_agent: str = "wands-research/0.1 (research; contact: ops@example.com)",
        url: str = FOMC_CALENDAR_URL,
    ) -> None:
        self.enabled = enabled
        self.ttl_seconds = ttl_seconds
        self.timeout_seconds = timeout_seconds
        self.user_agent = user_agent
        self.url = url

    def fetch(self, *, now: datetime) -> ProviderResult:
        if not self.enabled:
            return ProviderResult(
                source=self.source,
                label=self.label,
                status=STATUS_UNAVAILABLE,
                detail=(
                    "The FOMC calendar source is disabled "
                    "(WANDS_CATALYST_FOMC_ENABLED=false). No scheduled monetary "
                    "policy events are being read."
                ),
                events=(),
                source_url=self.url,
                fetched_at=None,
            )

        cached = self._cached(now)
        if cached is not None:
            return cached

        result = self._load(now)
        with _CACHE_LOCK:
            _CACHE[self.source] = _CacheEntry(stored_at=time.monotonic(), result=result)
        return result

    def _cached(self, now: datetime) -> ProviderResult | None:
        with _CACHE_LOCK:
            entry = _CACHE.get(self.source)
        if entry is None:
            return None
        if time.monotonic() - entry.stored_at > self.ttl_seconds:
            return None
        return entry.result

    def _load(self, now: datetime) -> ProviderResult:
        try:
            with httpx.Client(
                follow_redirects=True,
                timeout=self.timeout_seconds,
                headers={"User-Agent": self.user_agent},
            ) as client:
                response = client.get(self.url)
                response.raise_for_status()
                html = response.text
        except httpx.HTTPStatusError as error:
            return self._failed(
                now,
                f"The Federal Reserve returned HTTP {error.response.status_code} "
                f"for the FOMC calendar. No scheduled events could be read.",
            )
        except httpx.HTTPError as error:
            return self._failed(
                now,
                f"The FOMC calendar could not be reached ({type(error).__name__}). "
                "No scheduled events could be read.",
            )

        events = parse_fomc_calendar(html, source_url=self.url)
        if not events:
            # A page that parses to nothing is a parser or layout failure, not a
            # calendar with no meetings. Saying so is the difference between a
            # degraded source and a false claim that the Fed has no meetings.
            return self._failed(
                now,
                "The FOMC calendar page was retrieved but no meeting rows could be "
                "read from it. The page layout may have changed.",
            )

        return ProviderResult(
            source=self.source,
            label=self.label,
            status=STATUS_OK,
            detail=f"Read {len(events)} FOMC meetings from the Federal Reserve.",
            events=tuple(events),
            source_url=self.url,
            fetched_at=now,
        )

    def _failed(self, now: datetime, detail: str) -> ProviderResult:
        return ProviderResult(
            source=self.source,
            label=self.label,
            status=STATUS_FAILED,
            detail=detail,
            events=(),
            source_url=self.url,
            fetched_at=now,
        )


def default_providers(
    *,
    fomc_enabled: bool = True,
    fomc_ttl_seconds: int = 21600,
    fomc_timeout_seconds: float = 10.0,
    user_agent: str = "wands-research/0.1 (research; contact: ops@example.com)",
) -> list[ScheduledCatalystProvider]:
    return [
        FomcCalendarProvider(
            enabled=fomc_enabled,
            ttl_seconds=fomc_ttl_seconds,
            timeout_seconds=fomc_timeout_seconds,
            user_agent=user_agent,
        )
    ]


__all__ = [
    "FOMC_CALENDAR_URL",
    "FOMC_SOURCE_KEY",
    "FOMC_SOURCE_NAME",
    "FOMC_TIME_ZONE",
    "FomcCalendarProvider",
    "ProviderResult",
    "ScheduledCatalystProvider",
    "ScheduledEvent",
    "STATUS_FAILED",
    "STATUS_OK",
    "STATUS_UNAVAILABLE",
    "default_providers",
    "parse_fomc_calendar",
    "reset_cache",
]
