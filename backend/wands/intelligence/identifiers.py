"""Versioned security identifier resolution.

A 13F reports a CUSIP. A signal is about a ticker. Between those two facts sits
a mapping that changes over time, and getting it wrong is the quietest way to
produce a fake backtest: map an old filing to today's ticker and the strategy
appears to have predicted a company it never mentioned.

Three rules follow from that.

*A CUSIP is not derivable from a ticker.* Nothing here guesses. A mapping exists
because a source asserted it, and the source is stored with the claim.

*Every mapping has an effective window.* A lookup is a range query against the
date being asked about, never a read of the current row. A ticker change closes
the old window and opens a new one, so a 2016 filing resolves to the 2016 symbol.

*Unresolved is a real answer.* When no source covers a date, or two sources
disagree, the result is ``unresolved`` or ``conflict`` and the security is
excluded from ticker-level fusion. An excluded observation is visible; a wrong
one is not.
"""

from __future__ import annotations

import csv
import hashlib
import json
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from pathlib import Path
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.db.models import IntelSecurityIdentifierRow
from wands.logging import get_logger

logger = get_logger(__name__)

# A CUSIP is nine characters: eight identifying, one check digit. Filings
# frequently omit the check digit, so the base is what is stored and compared.
# Keeping the check digit would make the same security look like two.
CUSIP_BASE_LENGTH = 8

# Used when a source supplies no effective date. It is deliberately *not* a
# distant past date: a mapping observed today must not claim to describe 2010.
OBSERVED_AT = "observed_at"


class MappingStatus(StrEnum):
    """How much a mapping can be trusted."""

    # A licensed or official source asserted it and nothing contradicts it.
    VERIFIED = "verified"
    # Asserted, but the effective window is inferred rather than reported.
    PROVISIONAL = "provisional"
    # Two sources disagree over an overlapping window.
    CONFLICT = "conflict"
    # No source covers the requested date.
    UNRESOLVED = "unresolved"


# Only a verified mapping may feed ticker-level fusion. A provisional mapping is
# still shown, because hiding it would make coverage look better than it is.
FUSION_ELIGIBLE = frozenset({MappingStatus.VERIFIED})


def normalize_cusip(value: str) -> str:
    """Reduce a reported CUSIP to its eight-character base.

    Returns an empty string for anything that is not a plausible CUSIP, so a
    blank or malformed identifier becomes ``unresolved`` rather than matching
    some other security by accident.
    """
    text = "".join(character for character in str(value or "").upper() if character.isalnum())
    if len(text) < CUSIP_BASE_LENGTH:
        return ""
    return text[:CUSIP_BASE_LENGTH]


def cusip_check_digit(base: str) -> str:
    """The check digit for an eight-character CUSIP base.

    The digit is a deterministic function of the base, so restoring it from a
    stored base reproduces the identifier a filing reported rather than
    inventing one. Returns an empty string when the base is not a valid CUSIP
    base, which keeps a malformed identifier out of the request.
    """
    if len(base) != CUSIP_BASE_LENGTH:
        return ""
    total = 0
    for index, character in enumerate(base):
        if character.isdigit():
            value = int(character)
        elif "A" <= character <= "Z":
            value = ord(character) - ord("A") + 10
        elif character in "*@#":
            value = {"*": 36, "@": 37, "#": 38}[character]
        else:
            return ""
        if index % 2 == 1:
            value *= 2
        total += value // 10 + value % 10
    return str((10 - (total % 10)) % 10)


def full_cusip(value: str) -> str:
    """The nine-character CUSIP for a reported identifier.

    A 13F reports the full CUSIP, but a stored base may have lost its check
    digit. A nine-character value is accepted only when its digit checks out, so
    a corrupted identifier is rejected instead of being sent to a resolver.
    """
    text = "".join(
        character
        for character in str(value or "").upper()
        if character.isalnum() or character in "*@#"
    )
    if len(text) == CUSIP_BASE_LENGTH + 1:
        return text if text[-1] == cusip_check_digit(text[:CUSIP_BASE_LENGTH]) else ""
    if len(text) == CUSIP_BASE_LENGTH:
        digit = cusip_check_digit(text)
        return f"{text}{digit}" if digit else ""
    return ""


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


@dataclass(frozen=True)
class IdentifierMapping:
    """One claim that a CUSIP traded as a symbol over a window."""

    cusip: str
    symbol: str
    effective_from: datetime
    effective_to: datetime | None = None
    issuer_cik: str = ""
    issuer_name: str = ""
    security_description: str = ""
    share_class: str = ""
    source: str = ""
    verification_status: MappingStatus = MappingStatus.PROVISIONAL
    confidence: Decimal = Decimal("0")
    is_primary: bool = False
    notes: str = ""

    def covers(self, as_of: datetime) -> bool:
        moment = _as_utc(as_of)
        if moment < _as_utc(self.effective_from):
            return False
        if self.effective_to is None:
            return True
        return moment < _as_utc(self.effective_to)


@dataclass(frozen=True)
class Resolution:
    """The answer to "what did this CUSIP mean on this date"."""

    cusip: str
    as_of: datetime
    status: MappingStatus
    reason: str
    mapping: IdentifierMapping | None = None
    candidates: list[IdentifierMapping] = field(default_factory=list)

    @property
    def is_resolved(self) -> bool:
        return self.mapping is not None and self.status in {
            MappingStatus.VERIFIED,
            MappingStatus.PROVISIONAL,
        }

    @property
    def symbol(self) -> str | None:
        return self.mapping.symbol if self.is_resolved else None

    @property
    def usable_for_fusion(self) -> bool:
        """Whether this observation may enter a ticker-level calculation."""
        return (
            self.mapping is not None
            and self.status in FUSION_ELIGIBLE
            and bool(self.mapping.symbol)
        )


@dataclass
class IngestSummary:
    source: str = ""
    received: int = 0
    inserted: int = 0
    updated: int = 0
    rejected: int = 0
    conflicts: int = 0
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "received": self.received,
            "inserted": self.inserted,
            "updated": self.updated,
            "rejected": self.rejected,
            "conflicts": self.conflicts,
            "errors": list(self.errors),
        }


class MappingSource(Protocol):
    """A provider of identifier mappings.

    Implementations must be explicit about what they can and cannot supply. The
    SEC ticker file, for instance, supplies ticker and CIK but no CUSIP, and
    saying so is more useful than returning a partial row that looks complete.
    """

    name: str
    supplies_cusip: bool

    def fetch(self) -> list[IdentifierMapping]: ...


class SecCompanyTickersSource:
    """Ticker to CIK from the SEC's published company file.

    This source cannot resolve a CUSIP, and it does not pretend to. It is used
    to attach an issuer CIK to a mapping that came from somewhere else, and to
    answer "which CIK is this ticker" without a CUSIP in the picture.
    """

    name = "sec_company_tickers"
    supplies_cusip = False

    def __init__(self, client: Any, *, observed_at: datetime | None = None) -> None:
        self._client = client
        self._observed_at = observed_at

    def fetch(self) -> list[IdentifierMapping]:
        observed = _as_utc(self._observed_at or datetime.now(tz=UTC))
        tickers = self._client.company_tickers()
        mappings: list[IdentifierMapping] = []
        for symbol, cik in tickers.items():
            mappings.append(
                IdentifierMapping(
                    cusip="",
                    symbol=str(symbol).upper(),
                    issuer_cik=str(cik),
                    issuer_name=self._client.issuer_name(cik),
                    effective_from=observed,
                    source=self.name,
                    verification_status=MappingStatus.PROVISIONAL,
                    confidence=Decimal("50"),
                    notes=(
                        "Ticker and CIK only. The SEC file carries no CUSIP, so this "
                        "row cannot resolve a 13F holding."
                    ),
                )
            )
        return mappings


class FileMappingSource:
    """Operator-supplied CUSIP mappings from a JSON or CSV file.

    This is the seam for a licensed reference feed. The file is read, validated
    and stored with its own source name, so a mapping's provenance is the file
    it came from rather than "the system".
    """

    supplies_cusip = True

    def __init__(self, path: str | Path, *, name: str = "operator_file") -> None:
        self.path = Path(path)
        self.name = name

    def fetch(self) -> list[IdentifierMapping]:
        if not self.path.exists():
            raise FileNotFoundError(f"Identifier mapping file not found: {self.path}")
        text = self.path.read_text(encoding="utf-8")
        if self.path.suffix.lower() == ".csv":
            rows = list(csv.DictReader(text.splitlines()))
        else:
            payload = json.loads(text)
            rows = payload if isinstance(payload, list) else payload.get("mappings", [])
        return [mapping for mapping in (self._row_to_mapping(row) for row in rows) if mapping]

    def _row_to_mapping(self, row: dict[str, Any]) -> IdentifierMapping | None:
        cusip = normalize_cusip(str(row.get("cusip") or ""))
        symbol = str(row.get("symbol") or "").strip().upper()
        if not cusip or not symbol:
            return None
        effective_from = _parse_moment(row.get("effective_from"))
        notes = str(row.get("notes") or "")
        status = MappingStatus.PROVISIONAL
        if effective_from is None:
            # No reported start date. The mapping is treated as observed now,
            # which means a lookup before today returns unresolved instead of
            # silently claiming the ticker was always this.
            effective_from = _parse_moment(row.get("observed_at")) or datetime.now(tz=UTC)
            notes = (notes + " " + OBSERVED_AT).strip()
        declared = str(row.get("verification_status") or "").strip().lower()
        if declared in {status.value for status in MappingStatus}:
            status = MappingStatus(declared)
        return IdentifierMapping(
            cusip=cusip,
            symbol=symbol,
            effective_from=_as_utc(effective_from),
            effective_to=_parse_moment(row.get("effective_to")),
            issuer_cik=str(row.get("issuer_cik") or "").strip(),
            issuer_name=str(row.get("issuer_name") or "").strip(),
            security_description=str(row.get("security_description") or "").strip(),
            share_class=str(row.get("share_class") or "").strip(),
            source=self.name,
            verification_status=status,
            confidence=_parse_decimal(row.get("confidence"), Decimal("50")),
            is_primary=bool(row.get("is_primary")),
            notes=notes,
        )


class OpenFigiSource:
    """CUSIP to security resolution from the OpenFIGI mapping API.

    OpenFIGI is Bloomberg's open identifier registry. It is a legitimate public
    cross-reference: it answers "which security is this CUSIP" without a CUSIP
    Global Services licence, and it returns the exchange listings, the share
    class and the security type alongside the ticker.

    It is not a licensed CUSIP master file, and it is not treated as one. It
    reports what it knows at the moment it is asked, so a mapping it supplies is
    dated at observation time and is never backdated to a filing's period. A
    CUSIP that lists under more than one ticker is stored as a conflict for each
    ticker rather than resolved by preference, so the ambiguity stays visible.
    """

    name = "openfigi"
    supplies_cusip = True

    ENDPOINT = "https://api.openfigi.com/v3/mapping"
    # The mapping endpoint accepts at most ten identifiers per request.
    BATCH_SIZE = 10
    # An unauthenticated caller gets 25 requests a minute. The pause keeps a
    # larger pilot inside that budget instead of collecting 429s.
    BATCH_PAUSE_SECONDS = 2.5

    def __init__(
        self,
        cusips: Sequence[str],
        *,
        client: Any | None = None,
        api_key: str | None = None,
        observed_at: datetime | None = None,
        sleep=time.sleep,
        batch_pause: float | None = None,
    ) -> None:
        # Kept as reported: the resolver needs the full nine-character CUSIP,
        # while storage normalizes to the base.
        self.cusips = [str(cusip or "").strip().upper() for cusip in cusips]
        self._client = client
        self._api_key = api_key
        self._observed_at = observed_at
        self._sleep = sleep
        self._batch_pause = (
            self.BATCH_PAUSE_SECONDS if batch_pause is None else batch_pause
        )

    def fetch(self) -> list[IdentifierMapping]:
        observed = _as_utc(self._observed_at or datetime.now(tz=UTC))
        wanted = [cusip for cusip in dict.fromkeys(self.cusips) if full_cusip(cusip)]
        mappings: list[IdentifierMapping] = []
        for index in range(0, len(wanted), self.BATCH_SIZE):
            batch = wanted[index : index + self.BATCH_SIZE]
            if index:
                self._sleep(self._batch_pause)
            results = self._post(batch)
            if len(results) != len(batch):
                raise ValueError(
                    f"OpenFIGI returned {len(results)} results for {len(batch)} CUSIPs."
                )
            for cusip, payload in zip(batch, results, strict=True):
                mappings.extend(self._mappings(cusip, payload, observed))
        return mappings

    def _post(self, batch: list[str]) -> list[Any]:
        body = [{"idType": "ID_CUSIP", "idValue": full_cusip(cusip)} for cusip in batch]
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["X-OPENFIGI-APIKEY"] = self._api_key
        response = self._http().post(self.ENDPOINT, json=body, headers=headers)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, list):
            raise ValueError("OpenFIGI returned a non-list mapping response.")
        return payload

    def _mappings(
        self, cusip: str, payload: Any, observed: datetime
    ) -> list[IdentifierMapping]:
        base = normalize_cusip(cusip)
        rows = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(rows, list) or not rows:
            return []
        equities = [
            row
            for row in rows
            if isinstance(row, dict) and str(row.get("marketSector") or "") == "Equity"
        ]
        if not equities:
            return []
        # A CUSIP lists on many venues. The US composite is the listing a US
        # ticker refers to, so it decides the ticker when it is present; a
        # foreign listing must not turn one security into a conflict.
        us = [row for row in equities if str(row.get("exchCode") or "") == "US"]
        considered = us or equities
        tickers = sorted(
            {
                str(row.get("ticker") or "").strip().upper()
                for row in considered
                if str(row.get("ticker") or "").strip()
            }
        )
        if not tickers:
            return []
        if len(tickers) > 1:
            # One source, one date, one row: a claim is keyed on
            # (cusip, effective_from, source). The ambiguity is carried in the
            # status and the note rather than split across rows the uniqueness
            # rule would reject, and a conflict is never fusion-eligible.
            reason = (
                "OpenFIGI lists this CUSIP under several US tickers"
                if us
                else (
                    "OpenFIGI returned no US listing for this CUSIP and lists it "
                    "under several local tickers"
                )
            )
            return [
                IdentifierMapping(
                    cusip=base,
                    symbol=tickers[0],
                    effective_from=observed,
                    source=self.name,
                    verification_status=MappingStatus.CONFLICT,
                    confidence=Decimal("0"),
                    notes=(
                        f"{reason} ({', '.join(tickers)}), so it is not resolved to "
                        f"one security. {OBSERVED_AT}"
                    ),
                )
            ]

        chosen = considered[0]
        return [
            IdentifierMapping(
                cusip=base,
                symbol=tickers[0],
                effective_from=observed,
                issuer_name=str(chosen.get("name") or "").strip(),
                security_description=str(
                    chosen.get("securityType2") or chosen.get("securityType") or ""
                ).strip(),
                share_class=str(chosen.get("shareClassFIGI") or "").strip(),
                source=self.name,
                verification_status=MappingStatus.VERIFIED,
                confidence=Decimal("95"),
                is_primary=True,
                notes=(
                    "Resolved by CUSIP through OpenFIGI to a single equity listing"
                    + ("" if us else " (no US listing was returned)")
                    + ". share_class holds the share-class FIGI. "
                    + OBSERVED_AT
                ),
            )
        ]

    def _http(self):
        if self._client is None:
            import httpx

            self._client = httpx.Client(timeout=30.0, follow_redirects=True)
        return self._client


def _parse_moment(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return _as_utc(value)
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=UTC)
        except ValueError:
            return None
    return _as_utc(parsed)


def _parse_decimal(value: Any, fallback: Decimal) -> Decimal:
    if value in (None, ""):
        return fallback
    try:
        return Decimal(str(value))
    except (ArithmeticError, ValueError):
        return fallback


class IdentifierResolver:
    """Stores and queries versioned identifier mappings."""

    def __init__(self, session: Session) -> None:
        self.session = session

    # -- writing -----------------------------------------------------------

    def ingest(
        self, mappings: list[IdentifierMapping], *, source: str | None = None
    ) -> IngestSummary:
        """Store mappings, closing windows that a newer claim supersedes.

        A new mapping for a CUSIP that already has an open window closes that
        window at the new mapping's start. That is what makes a ticker change a
        history rather than an overwrite.
        """
        summary = IngestSummary(source=source or "")
        for mapping in mappings:
            summary.received += 1
            cusip = normalize_cusip(mapping.cusip)
            if not cusip or not mapping.symbol:
                summary.rejected += 1
                summary.errors.append(
                    f"Rejected a mapping with cusip={mapping.cusip!r} symbol={mapping.symbol!r}."
                )
                continue

            effective_from = _as_utc(mapping.effective_from)
            existing = self.session.scalar(
                select(IntelSecurityIdentifierRow).where(
                    IntelSecurityIdentifierRow.cusip == cusip,
                    IntelSecurityIdentifierRow.effective_from == effective_from,
                    IntelSecurityIdentifierRow.source == (source or mapping.source),
                )
            )
            if existing is not None:
                existing.symbol = mapping.symbol
                existing.issuer_cik = mapping.issuer_cik or existing.issuer_cik
                existing.issuer_name = mapping.issuer_name or existing.issuer_name
                existing.security_description = (
                    mapping.security_description or existing.security_description
                )
                existing.share_class = mapping.share_class or existing.share_class
                existing.effective_to = mapping.effective_to
                existing.verification_status = mapping.verification_status.value
                existing.confidence = mapping.confidence
                existing.is_primary = mapping.is_primary
                existing.notes = mapping.notes
                summary.updated += 1
                continue

            # A re-observation of the same claim is not a new version. Without
            # this, every collection run would add a row per CUSIP and the
            # history would fill with identical open windows.
            open_row = self.session.scalar(
                select(IntelSecurityIdentifierRow).where(
                    IntelSecurityIdentifierRow.cusip == cusip,
                    IntelSecurityIdentifierRow.source == (source or mapping.source),
                    IntelSecurityIdentifierRow.symbol == mapping.symbol,
                    IntelSecurityIdentifierRow.effective_to.is_(None),
                )
            )
            if open_row is not None:
                open_row.issuer_cik = mapping.issuer_cik or open_row.issuer_cik
                open_row.issuer_name = mapping.issuer_name or open_row.issuer_name
                open_row.security_description = (
                    mapping.security_description or open_row.security_description
                )
                open_row.share_class = mapping.share_class or open_row.share_class
                open_row.verification_status = mapping.verification_status.value
                open_row.confidence = mapping.confidence
                open_row.is_primary = mapping.is_primary
                open_row.notes = mapping.notes
                summary.updated += 1
                continue

            # Flush first: the session runs with autoflush off, so a row added
            # earlier in this same call is invisible to the window query below
            # until it is written.
            self.session.flush()
            self._close_superseded_window(cusip, effective_from, mapping.symbol)
            self.session.add(
                IntelSecurityIdentifierRow(
                    cusip=cusip,
                    symbol=mapping.symbol,
                    issuer_cik=mapping.issuer_cik,
                    issuer_name=mapping.issuer_name,
                    security_description=mapping.security_description,
                    share_class=mapping.share_class,
                    effective_from=effective_from,
                    effective_to=mapping.effective_to,
                    source=source or mapping.source,
                    verification_status=mapping.verification_status.value,
                    confidence=mapping.confidence,
                    is_primary=mapping.is_primary,
                    notes=mapping.notes,
                )
            )
            summary.inserted += 1

        self.session.flush()
        summary.conflicts = self._mark_conflicts()
        self.session.flush()
        logger.info(
            "identifier mappings ingested",
            extra={"event": "intelligence.identifiers.ingest", "context": summary.as_dict()},
        )
        return summary

    def _close_superseded_window(
        self, cusip: str, effective_from: datetime, symbol: str
    ) -> None:
        """Close an open window that a different symbol now supersedes."""
        open_rows = self.session.scalars(
            select(IntelSecurityIdentifierRow).where(
                IntelSecurityIdentifierRow.cusip == cusip,
                IntelSecurityIdentifierRow.effective_to.is_(None),
                IntelSecurityIdentifierRow.effective_from < effective_from,
            )
        ).all()
        for row in open_rows:
            if row.symbol.upper() == symbol.upper():
                continue
            row.effective_to = effective_from
            row.notes = (
                row.notes + f" Window closed at {effective_from.isoformat()} by a later mapping."
            ).strip()

    def _mark_conflicts(self) -> int:
        """Flag CUSIPs whose sources disagree over an overlapping window.

        A conflict is not resolved by preferring one source. Both rows are kept
        and both are marked, so the security drops out of fusion until a human
        or a better source settles it.
        """
        rows = self.session.scalars(select(IntelSecurityIdentifierRow)).all()
        by_cusip: dict[str, list[IntelSecurityIdentifierRow]] = {}
        for row in rows:
            by_cusip.setdefault(row.cusip, []).append(row)

        conflicts = 0
        for cusip, group in by_cusip.items():
            if len({row.symbol.upper() for row in group}) < 2:
                continue
            for left in group:
                for right in group:
                    if left is right or left.symbol.upper() == right.symbol.upper():
                        continue
                    if not _overlaps(left, right):
                        continue
                    for row in (left, right):
                        if row.verification_status != MappingStatus.CONFLICT.value:
                            row.verification_status = MappingStatus.CONFLICT.value
                            row.notes = (
                                row.notes
                                + f" Conflicting symbol for {cusip} over an overlapping window."
                            ).strip()
                            conflicts += 1
        return conflicts

    # -- reading -----------------------------------------------------------

    def resolve(self, cusip: str, as_of: datetime) -> Resolution:
        """What this CUSIP meant at ``as_of``.

        The window query is the whole point: a mapping that starts after the
        date asked about is not an answer, and neither is one that ended before
        it.
        """
        base = normalize_cusip(cusip)
        moment = _as_utc(as_of)
        if not base:
            return Resolution(
                cusip=str(cusip or ""),
                as_of=moment,
                status=MappingStatus.UNRESOLVED,
                reason="The reported identifier is not a usable CUSIP.",
            )

        rows = self.session.scalars(
            select(IntelSecurityIdentifierRow).where(
                IntelSecurityIdentifierRow.cusip == base
            )
        ).all()
        if not rows:
            return Resolution(
                cusip=base,
                as_of=moment,
                status=MappingStatus.UNRESOLVED,
                reason=(
                    "No identifier source covers this CUSIP. It is excluded from "
                    "ticker-level calculations rather than guessed at."
                ),
            )

        covering = [
            _to_mapping(row) for row in rows if _to_mapping(row).covers(moment)
        ]
        if not covering:
            return Resolution(
                cusip=base,
                as_of=moment,
                status=MappingStatus.UNRESOLVED,
                reason=(
                    "No mapping window covers this date. The security may not have "
                    "existed yet, or the source does not reach back this far."
                ),
                candidates=[_to_mapping(row) for row in rows],
            )

        symbols = {mapping.symbol.upper() for mapping in covering}
        if len(symbols) > 1:
            return Resolution(
                cusip=base,
                as_of=moment,
                status=MappingStatus.CONFLICT,
                reason=(
                    "Sources disagree about this CUSIP over an overlapping window: "
                    + ", ".join(sorted(symbols))
                    + "."
                ),
                candidates=covering,
            )

        chosen = _prefer(covering)
        if chosen.verification_status is MappingStatus.CONFLICT:
            return Resolution(
                cusip=base,
                as_of=moment,
                status=MappingStatus.CONFLICT,
                reason="The stored mapping is flagged as conflicting.",
                candidates=covering,
            )
        return Resolution(
            cusip=base,
            as_of=moment,
            status=chosen.verification_status,
            reason=f"Resolved from {chosen.source or 'an unnamed source'}.",
            mapping=chosen,
            candidates=covering,
        )

    def resolve_symbol(self, symbol: str, as_of: datetime) -> Resolution:
        """The reverse lookup, used to check a ticker's own history."""
        wanted = str(symbol or "").strip().upper()
        moment = _as_utc(as_of)
        if not wanted:
            return Resolution(
                cusip="",
                as_of=moment,
                status=MappingStatus.UNRESOLVED,
                reason="No symbol was supplied.",
            )
        rows = self.session.scalars(
            select(IntelSecurityIdentifierRow).where(
                IntelSecurityIdentifierRow.symbol == wanted
            )
        ).all()
        covering = [_to_mapping(row) for row in rows if _to_mapping(row).covers(moment)]
        if not covering:
            return Resolution(
                cusip="",
                as_of=moment,
                status=MappingStatus.UNRESOLVED,
                reason=f"No mapping window covers {wanted} on this date.",
            )
        chosen = _prefer(covering)
        return Resolution(
            cusip=chosen.cusip,
            as_of=moment,
            status=chosen.verification_status,
            reason=f"Resolved from {chosen.source or 'an unnamed source'}.",
            mapping=chosen,
            candidates=covering,
        )

    def cusip_map(self, symbols: Sequence[str], as_of: datetime) -> dict[str, str]:
        """Symbol -> CUSIP for the symbols whose mapping is fusion-eligible.

        Only a mapping that may enter a ticker-level calculation is returned. An
        unresolved or conflicting CUSIP is left out so the caller reports the
        omission instead of scoring a guess.
        """
        result: dict[str, str] = {}
        for symbol in symbols:
            resolution = self.resolve_symbol(symbol, as_of)
            if resolution.usable_for_fusion and resolution.mapping is not None:
                result[str(symbol).strip().upper()] = resolution.mapping.cusip
        return result

    def history(self, cusip: str) -> list[IdentifierMapping]:
        base = normalize_cusip(cusip)
        if not base:
            return []
        rows = self.session.scalars(
            select(IntelSecurityIdentifierRow)
            .where(IntelSecurityIdentifierRow.cusip == base)
            .order_by(IntelSecurityIdentifierRow.effective_from)
        ).all()
        return [_to_mapping(row) for row in rows]

    def coverage(self) -> dict[str, Any]:
        """How much of the identifier universe is actually usable.

        Reported as counts rather than a percentage alone, because "62% resolved"
        hides whether the missing 38% is one obscure issuer or the whole market.
        """
        rows = self.session.scalars(select(IntelSecurityIdentifierRow)).all()
        by_status: dict[str, int] = {}
        cusips: set[str] = set()
        resolved_cusips: set[str] = set()
        for row in rows:
            by_status[row.verification_status] = by_status.get(row.verification_status, 0) + 1
            cusips.add(row.cusip)
            if row.verification_status == MappingStatus.VERIFIED.value and row.symbol:
                resolved_cusips.add(row.cusip)
        total = len(cusips)
        return {
            "mappings": len(rows),
            "distinctCusips": total,
            "verifiedCusips": len(resolved_cusips),
            "unresolvedCusips": total - len(resolved_cusips),
            "byStatus": by_status,
            "fusionEligible": len(resolved_cusips),
            "sources": sorted({row.source for row in rows if row.source}),
        }


def _to_mapping(row: IntelSecurityIdentifierRow) -> IdentifierMapping:
    return IdentifierMapping(
        cusip=row.cusip,
        symbol=row.symbol,
        effective_from=_as_utc(row.effective_from),
        effective_to=_as_utc(row.effective_to) if row.effective_to else None,
        issuer_cik=row.issuer_cik,
        issuer_name=row.issuer_name,
        security_description=row.security_description,
        share_class=row.share_class,
        source=row.source,
        verification_status=MappingStatus(row.verification_status),
        confidence=row.confidence,
        is_primary=row.is_primary,
        notes=row.notes,
    )


def _overlaps(left: IntelSecurityIdentifierRow, right: IntelSecurityIdentifierRow) -> bool:
    left_end = _as_utc(left.effective_to) if left.effective_to else None
    right_end = _as_utc(right.effective_to) if right.effective_to else None
    left_start = _as_utc(left.effective_from)
    right_start = _as_utc(right.effective_from)
    if left_end is not None and left_end <= right_start:
        return False
    if right_end is not None and right_end <= left_start:
        return False
    return True


def _prefer(candidates: list[IdentifierMapping]) -> IdentifierMapping:
    """Pick the most trustworthy covering mapping.

    Verified beats provisional, a primary share class beats a secondary one, and
    a later effective date beats an earlier one. The ordering is fixed so the
    same inputs always produce the same answer.
    """
    rank = {
        MappingStatus.VERIFIED: 0,
        MappingStatus.PROVISIONAL: 1,
        MappingStatus.CONFLICT: 2,
        MappingStatus.UNRESOLVED: 3,
    }
    return sorted(
        candidates,
        key=lambda mapping: (
            rank.get(mapping.verification_status, 9),
            0 if mapping.is_primary else 1,
            -_as_utc(mapping.effective_from).timestamp(),
        ),
    )[0]


def definition_fingerprint(mappings: list[IdentifierMapping]) -> str:
    """A stable hash of a mapping set, for experiment reproducibility."""
    payload = [
        {
            "cusip": mapping.cusip,
            "symbol": mapping.symbol,
            "from": _as_utc(mapping.effective_from).isoformat(),
            "to": _as_utc(mapping.effective_to).isoformat() if mapping.effective_to else None,
            "source": mapping.source,
            "status": mapping.verification_status.value,
        }
        for mapping in sorted(mappings, key=lambda item: (item.cusip, item.effective_from))
    ]
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


__all__ = [
    "FileMappingSource",
    "IdentifierMapping",
    "IdentifierResolver",
    "IngestSummary",
    "MappingSource",
    "MappingStatus",
    "Resolution",
    "SecCompanyTickersSource",
    "definition_fingerprint",
    "normalize_cusip",
]
