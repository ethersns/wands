"""Intelligence subsystem contracts.

Research data is a different kind of claim from market data, so it gets its own
vocabulary. A filing is *reported*: a named person told the SEC something and we
stored it verbatim. A signal is *derived*: we computed it from reported events
and it can be wrong. Neither is ever ``live``, because neither is a price.

Nothing in this package imports the broker, execution or risk modules. That is
enforced by the import graph, not by convention: an intelligence module that
tried to place an order would fail to import.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import StrEnum


class IntelError(Exception):
    """Base class for intelligence failures. Never swallowed without a record."""


class SourceNotConfigured(IntelError):
    """The collector is disabled or has no credential. Not retryable."""


class SourceUnavailable(IntelError):
    """Transport failure, timeout or 5xx. Retryable."""


class SourceRateLimited(IntelError):
    """The source asked us to slow down. Retryable after a delay."""

    def __init__(self, message: str, *, retry_after_seconds: float | None = None) -> None:
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


class SourceDataError(IntelError):
    """The source answered, but the payload cannot be trusted. Not retryable."""


class TransactionClass(StrEnum):
    """What a reported transaction actually was.

    The distinction that matters is ``OPEN_MARKET_PURCHASE`` versus everything
    else. An award, a gift, a tax withholding and a derivative exercise all move
    shares and none of them is a decision to buy in the market at a price.
    """

    OPEN_MARKET_PURCHASE = "open_market_purchase"
    OPEN_MARKET_SALE = "open_market_sale"
    AWARD_GRANT = "award_grant"
    TAX_WITHHOLDING = "tax_withholding"
    GIFT = "gift"
    DERIVATIVE_EXERCISE = "derivative_exercise"
    DISPOSITION_TO_ISSUER = "disposition_to_issuer"
    OTHER = "other"


class IntelQuality(StrEnum):
    """How much of the underlying fact we actually have."""

    # Every field needed for the measurement was reported by the source.
    REPORTED = "reported"
    # Computed from reported events; the arithmetic is ours, the inputs are not.
    DERIVED = "derived"
    # A required field was absent, so part of the measurement is unknown.
    INCOMPLETE = "incomplete"
    # Nothing was stored. The API says so instead of returning a zero.
    UNAVAILABLE = "unavailable"


class SignalCategory(StrEnum):
    INSIDER_PURCHASE_CLUSTER = "INSIDER_PURCHASE_CLUSTER"
    INSIDER_PURCHASE_VALUE = "INSIDER_PURCHASE_VALUE"
    INSIDER_ACTIVITY_CHANGE = "INSIDER_ACTIVITY_CHANGE"
    INSIDER_SELLING_CLUSTER = "INSIDER_SELLING_CLUSTER"
    INSTITUTIONAL_POSITION_CHANGE = "INSTITUTIONAL_POSITION_CHANGE"
    MARKET_TREND = "MARKET_TREND"
    VOLUME_ANOMALY = "VOLUME_ANOMALY"


@dataclass(frozen=True)
class FilingRef:
    """A filing as the index describes it, before the document is parsed."""

    accession_number: str
    form_type: str
    issuer_cik: str
    issuer_name: str
    symbol: str
    filed_date: datetime | None
    accepted_at: datetime
    period_of_report: datetime | None
    primary_document: str
    source_url: str
    is_amendment: bool = False


@dataclass(frozen=True)
class ParsedTransaction:
    """One transaction line, normalised out of the source XML."""

    table_kind: str
    ordinal: int
    security_title: str
    transaction_date: datetime | None
    transaction_code: str
    acquired_disposed: str
    shares: Decimal | None
    price_per_share: Decimal | None
    shares_owned_after: Decimal | None
    direct_or_indirect: str
    nature_of_ownership: str
    footnote_ids: list[str] = field(default_factory=list)

    @property
    def is_derivative(self) -> bool:
        return self.table_kind == "derivative"

    @property
    def value(self) -> Decimal | None:
        """Reported shares times reported price, or ``None``.

        A missing price is not a zero price. Returning ``None`` keeps an award
        or a gift out of an aggregate purchase value instead of diluting it.
        """
        if self.shares is None or self.price_per_share is None:
            return None
        return self.shares * self.price_per_share


@dataclass(frozen=True)
class ReportingOwner:
    """One person or entity named on the filing.

    A filing can name several owners (joint filers, a fund and its manager). Each
    is stored separately so a cluster count is a count of distinct filers rather
    than a count of documents.
    """

    cik: str
    name: str
    is_director: bool = False
    is_officer: bool = False
    is_ten_percent_owner: bool = False
    officer_title: str = ""


@dataclass(frozen=True)
class ParsedFiling:
    """A parsed ownership document.

    ``transactions`` are the document's reported lines. They are attributed to
    every owner on the filing, which is what a joint filing means.
    """

    accession_number: str
    form_type: str
    document_type: str
    issuer_cik: str
    issuer_name: str
    symbol: str
    period_of_report: datetime | None
    accepted_at: datetime
    source_url: str
    is_amendment: bool
    original_submission_date: datetime | None
    owners: list[ReportingOwner]
    transactions: list[ParsedTransaction]
    raw_sha256: str = ""


@dataclass(frozen=True)
class ParsedHolding:
    """One 13F information-table line."""

    ordinal: int
    cusip: str
    issuer_name: str
    class_title: str
    value_usd: Decimal | None
    shares: Decimal | None
    share_type: str
    put_call: str
    investment_discretion: str
    voting_sole: Decimal | None
    voting_shared: Decimal | None
    voting_none: Decimal | None


@dataclass(frozen=True)
class ParsedInstitutionalFiling:
    accession_number: str
    cik: str
    institution_name: str
    period_of_report: datetime
    filed_date: datetime | None
    accepted_at: datetime
    source_url: str
    is_amendment: bool
    holdings: list[ParsedHolding]


@dataclass(frozen=True)
class SignalDraft:
    """A signal before it is persisted.

    ``public_available_at`` is the latest moment any of its source events became
    public. A backtest may not see the signal before that instant, which is why
    it is a required field rather than something derived at read time.
    """

    category: SignalCategory
    symbol: str
    source_event_ids: list[str]
    event_time: datetime
    public_available_at: datetime
    raw_measurement: Decimal
    raw_unit: str
    explanation: str
    data_quality: IntelQuality
    confidence_notes: str
    parameters: dict[str, object] = field(default_factory=dict)
    score: Decimal | None = None
