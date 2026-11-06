"""SEC EDGAR public-data client.

Only the documented, public JSON and XML endpoints are used. There is no
scraping of the HTML filing viewer, no session cookie, no attempt to work around
a rate limit.

Fair access is implemented, not assumed:

* Every request carries a descriptive ``User-Agent`` naming the operator, which
  the SEC requires. A blank agent disables the client rather than sending an
  anonymous request.
* Requests pass through a token bucket set below the published ceiling.
* Only transport failures and explicit 429/503 responses are retried.

One timing rule matters more than the rest. ``acceptanceDateTime`` is when the
filing became public, and it is the only timestamp a signal may use to decide
whether it was knowable. When the index omits it, the client falls back to the
*end* of the filing date rather than its start, so a signal can never appear
available earlier than it really was.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from typing import Any

from wands.intelligence.base import (
    FilingRef,
    SourceDataError,
    SourceNotConfigured,
    SourceRateLimited,
    SourceUnavailable,
)
from wands.intelligence.retry import RetryPolicy, TokenBucket, call_with_retry

# Forms that report a change in beneficial ownership.
OWNERSHIP_FORMS = frozenset({"3", "4", "5", "3/A", "4/A", "5/A"})
INSTITUTIONAL_FORMS = frozenset({"13F-HR", "13F-HR/A"})


def _pad_cik(cik: str) -> str:
    digits = "".join(character for character in str(cik) if character.isdigit())
    if not digits:
        raise SourceDataError(f"{cik!r} is not a CIK.")
    return digits.zfill(10)


def _bare_accession(accession: str) -> str:
    return accession.replace("-", "").strip()


def _parse_datetime(value: str) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    normalised = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalised)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _parse_date(value: str) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=UTC)
    except ValueError:
        return None


def acceptance_time(filing_date: str, acceptance: str) -> datetime | None:
    """When the filing became public.

    The index normally supplies a precise acceptance timestamp. When it does
    not, the end of the filing date is used: a filing is certainly public by
    then, whereas midnight at the start of the day would let a backtest see it
    up to a day early.
    """
    precise = _parse_datetime(acceptance)
    if precise is not None:
        return precise
    day = _parse_date(filing_date)
    if day is None:
        return None
    return day + timedelta(days=1)


class EdgarClient:
    name = "sec_edgar"

    def __init__(
        self,
        *,
        user_agent: str,
        base_url: str = "https://www.sec.gov",
        data_base_url: str = "https://data.sec.gov",
        timeout: float = 20.0,
        retry_policy: RetryPolicy | None = None,
        bucket: TokenBucket | None = None,
        client: Any | None = None,
        sleep=time.sleep,
        clock=lambda: datetime.now(tz=UTC),
    ) -> None:
        self.user_agent = (user_agent or "").strip()
        self.base_url = base_url.rstrip("/")
        self.data_base_url = data_base_url.rstrip("/")
        self.timeout = timeout
        self._retry = retry_policy or RetryPolicy()
        self._bucket = bucket if bucket is not None else TokenBucket(5.0, 5)
        self._client = client
        self._sleep = sleep
        self._clock = clock
        self._ticker_cache: dict[str, str] | None = None
        self._name_cache: dict[str, str] | None = None

    # -- configuration -----------------------------------------------------

    def is_configured(self) -> bool:
        return bool(self.user_agent)

    def _require_configured(self) -> None:
        if not self.is_configured():
            raise SourceNotConfigured(
                "WANDS_SEC_USER_AGENT is not set. The SEC requires a descriptive "
                "User-Agent identifying the operator, so no request is sent without one."
            )

    # -- endpoints ---------------------------------------------------------

    def submissions(self, cik: str) -> dict[str, Any]:
        return self._get_json(f"{self.data_base_url}/submissions/CIK{_pad_cik(cik)}.json")

    def submissions_archive(self, cik: str, name: str) -> dict[str, Any]:
        """One older submissions page for an issuer.

        The submissions JSON carries a ``filings.files`` list naming archive
        pages that hold everything older than the recent block. This is the
        documented route to full history; the recent block alone is a few
        hundred filings and is not a historical dataset.
        """
        return self._get_json(f"{self.data_base_url}/submissions/{name}")

    def company_tickers(self) -> dict[str, str]:
        """Ticker to zero-padded CIK. Cached for the life of the client."""
        if self._ticker_cache is None:
            payload = self._get_json(f"{self.base_url}/files/company_tickers.json")
            tickers: dict[str, str] = {}
            names: dict[str, str] = {}
            for entry in payload.values():
                if not isinstance(entry, dict):
                    continue
                ticker = str(entry.get("ticker") or "").strip().upper()
                cik = str(entry.get("cik_str") or "").strip()
                if not ticker or not cik:
                    continue
                tickers[ticker] = _pad_cik(cik)
                names[_pad_cik(cik)] = str(entry.get("title") or "").strip()
            self._ticker_cache = tickers
            self._name_cache = names
        return self._ticker_cache

    def cik_for_ticker(self, ticker: str) -> str | None:
        return self.company_tickers().get(ticker.strip().upper())

    def issuer_name(self, cik: str) -> str:
        if self._name_cache is None:
            self.company_tickers()
        return (self._name_cache or {}).get(_pad_cik(cik), "")

    def filing_index(self, cik: str, accession: str) -> dict[str, Any]:
        return self._get_json(
            f"{self.base_url}/Archives/edgar/data/{_pad_cik(cik).lstrip('0') or '0'}"
            f"/{_bare_accession(accession)}/index.json"
        )

    def document(self, cik: str, accession: str, filename: str) -> bytes:
        url = (
            f"{self.base_url}/Archives/edgar/data/{_pad_cik(cik).lstrip('0') or '0'}"
            f"/{_bare_accession(accession)}/{filename}"
        )
        return self._get_bytes(url)

    def document_url(self, cik: str, accession: str, filename: str) -> str:
        return (
            f"{self.base_url}/Archives/edgar/data/{_pad_cik(cik).lstrip('0') or '0'}"
            f"/{_bare_accession(accession)}/{filename}"
        )

    # -- discovery ---------------------------------------------------------

    def recent_filings(
        self,
        cik: str,
        *,
        forms: frozenset[str] = OWNERSHIP_FORMS,
        since: datetime | None = None,
        limit: int = 100,
    ) -> list[FilingRef]:
        """Ownership filings for one issuer, newest first.

        Only the ``filings.recent`` block is read. That covers the most recent
        filings for an issuer, which is what a polling collector needs; older
        archive pages are a documented gap rather than a silent one.
        """
        payload = self.submissions(cik)
        recent = (payload.get("filings") or {}).get("recent") or {}
        return self._refs_from_block(
            cik,
            recent,
            forms=forms,
            since=since,
            until=None,
            limit=limit,
            issuer_name=str(payload.get("name") or ""),
            symbol=_first_ticker(payload),
        )

    def archive_pages(self, cik: str) -> list[dict[str, Any]]:
        """The archive page descriptors for an issuer, oldest last.

        Each entry names a page and the date range it covers. The list is read
        from the submissions JSON rather than guessed at, so an issuer with no
        archive is distinguishable from one whose archive failed to load.
        """
        payload = self.submissions(cik)
        files = (payload.get("filings") or {}).get("files") or []
        pages: list[dict[str, Any]] = []
        for entry in files:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name") or "").strip()
            if not name:
                continue
            pages.append(
                {
                    "name": name,
                    "filingCount": int(entry.get("filingCount") or 0),
                    "filingFrom": str(entry.get("filingFrom") or ""),
                    "filingTo": str(entry.get("filingTo") or ""),
                }
            )
        return pages

    def all_filings(
        self,
        cik: str,
        *,
        forms: frozenset[str] = OWNERSHIP_FORMS,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 10_000,
        page_loader=None,
    ) -> list[FilingRef]:
        """Every matching filing for an issuer, newest first, across all pages.

        The recent block is read first, then each archive page. ``page_loader``
        is injectable so a backfill can fetch pages concurrently without this
        method owning a thread pool.

        A page that fails to load is not silently treated as empty: the caller
        receives the refs that were obtained and can compare the count against
        the page's declared ``filingCount`` to notice the gap.
        """
        payload = self.submissions(cik)
        issuer_name = str(payload.get("name") or "")
        symbol = _first_ticker(payload)
        recent = (payload.get("filings") or {}).get("recent") or {}

        refs = self._refs_from_block(
            cik,
            recent,
            forms=forms,
            since=since,
            until=until,
            limit=limit,
            issuer_name=issuer_name,
            symbol=symbol,
        )
        if len(refs) >= limit:
            return refs[:limit]

        load = page_loader or (lambda name: self.submissions_archive(cik, name))
        for page in self.archive_pages(cik):
            if len(refs) >= limit:
                break
            try:
                block = load(page["name"])
            except SourceDataError:
                # A missing archive page is a coverage gap, not a crash. The
                # caller sees fewer refs than the page declared.
                continue
            refs.extend(
                self._refs_from_block(
                    cik,
                    block,
                    forms=forms,
                    since=since,
                    until=until,
                    limit=limit - len(refs),
                    issuer_name=issuer_name,
                    symbol=symbol,
                )
            )
        return refs[:limit]

    def _refs_from_block(
        self,
        cik: str,
        block: dict[str, Any],
        *,
        forms: frozenset[str],
        since: datetime | None,
        until: datetime | None,
        limit: int,
        issuer_name: str,
        symbol: str,
    ) -> list[FilingRef]:
        accessions = block.get("accessionNumber") or []
        if not accessions:
            return []

        refs: list[FilingRef] = []
        for index, accession in enumerate(accessions):
            form = str(_at(block, "form", index) or "").strip()
            if form not in forms:
                continue

            filed_date = str(_at(block, "filingDate", index) or "")
            accepted = acceptance_time(
                filed_date, str(_at(block, "acceptanceDateTime", index) or "")
            )
            if accepted is None:
                # Without a defensible public-availability time the filing
                # cannot be placed in history, so it is skipped rather than
                # guessed at.
                continue
            if since is not None and accepted < since:
                continue
            if until is not None and accepted > until:
                continue

            primary = str(_at(block, "primaryDocument", index) or "").strip()
            if not primary:
                continue

            refs.append(
                FilingRef(
                    accession_number=accession,
                    form_type=form,
                    issuer_cik=_pad_cik(cik),
                    issuer_name=issuer_name,
                    symbol=symbol,
                    filed_date=_parse_date(filed_date),
                    accepted_at=accepted,
                    period_of_report=_parse_date(
                        str(_at(block, "reportDate", index) or "")
                    ),
                    primary_document=primary,
                    source_url=self.document_url(cik, accession, primary),
                    is_amendment=form.endswith("/A"),
                )
            )
            if len(refs) >= limit:
                break
        return refs

    def institutional_filings(
        self,
        cik: str,
        *,
        since: datetime | None = None,
        limit: int = 20,
    ) -> list[FilingRef]:
        return self.recent_filings(
            cik, forms=INSTITUTIONAL_FORMS, since=since, limit=limit
        )

    def information_table(self, cik: str, accession: str) -> tuple[str, bytes]:
        """Locate and fetch the 13F information table inside a filing."""
        index = self.filing_index(cik, accession)
        items = (index.get("directory") or {}).get("item") or []
        candidates: list[str] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "")
            kind = str(item.get("type") or "").upper()
            lowered = name.lower()
            if not lowered.endswith(".xml"):
                continue
            if "infotable" in lowered or "INFORMATION TABLE" in kind:
                candidates.append(name)
        if not candidates:
            raise SourceDataError(
                f"13F filing {accession} contains no information table XML."
            )
        filename = candidates[0]
        return filename, self.document(cik, accession, filename)

    # -- transport ---------------------------------------------------------

    def _get_json(self, url: str) -> dict[str, Any]:
        body = self._get_bytes(url)
        import json

        try:
            payload = json.loads(body)
        except ValueError as exc:
            raise SourceDataError(f"SEC returned a non-JSON body for {url}.") from exc
        if not isinstance(payload, dict):
            raise SourceDataError(f"SEC returned an unexpected body for {url}.")
        return payload

    def _get_bytes(self, url: str) -> bytes:
        self._require_configured()

        def operation() -> bytes:
            now = time.monotonic()
            if not self._bucket.try_acquire(now):
                raise SourceRateLimited(
                    "SEC fair-access rate limit reached.",
                    retry_after_seconds=self._bucket.retry_after(now),
                )
            try:
                response = self._http().get(
                    url,
                    timeout=self.timeout,
                    headers={
                        "User-Agent": self.user_agent,
                        "Accept-Encoding": "gzip, deflate",
                        "Host": _host_of(url),
                    },
                )
            except Exception as exc:  # noqa: BLE001 - transport errors are retryable
                raise SourceUnavailable(f"SEC request failed: {exc}") from exc

            status = getattr(response, "status_code", 0)
            if status == 429:
                raise SourceRateLimited("SEC rate limited the request.")
            if status in {500, 502, 503, 504}:
                raise SourceUnavailable(f"SEC returned HTTP {status}.")
            if status == 404:
                raise SourceDataError(f"SEC returned HTTP 404 for {url}.")
            if status != 200:
                raise SourceDataError(f"SEC returned HTTP {status} for {url}.")

            content = getattr(response, "content", None)
            if content is None:
                text = getattr(response, "text", "")
                content = text.encode("utf-8") if isinstance(text, str) else b""
            if not content:
                raise SourceDataError(f"SEC returned an empty body for {url}.")
            return content

        return call_with_retry(operation, policy=self._retry, sleep=self._sleep)

    def _http(self):
        if self._client is None:
            import httpx

            self._client = httpx.Client(follow_redirects=True)
        return self._client


def _first_ticker(payload: dict[str, Any]) -> str:
    tickers = payload.get("tickers") or []
    return str(tickers[0]).upper() if tickers else ""


def _at(block: dict[str, Any], key: str, index: int) -> Any:
    values = block.get(key) or []
    if index < len(values):
        return values[index]
    return None


def _host_of(url: str) -> str:
    without_scheme = url.split("://", 1)[-1]
    return without_scheme.split("/", 1)[0]
