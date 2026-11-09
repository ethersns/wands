"""Wire schemas for the intelligence API.

These mirror the intelligence section of ``lib/api/contracts.ts`` field for
field. The frontend is the contract, so the models are camelCase on the wire and
snake_case in Python, exactly like the rest of the engine.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import Field

from wands.schemas import CamelModel


class IntelSourceStatusOut(CamelModel):
    source: str
    status: str
    last_attempt_at: datetime | None = None
    last_success_at: datetime | None = None
    age_seconds: int | None = None
    stale_after_seconds: int
    detail: str


class IntelStatusOut(CamelModel):
    enabled: bool
    freshness: str
    sources: list[IntelSourceStatusOut]
    filings: int
    transactions: int
    signals: int
    institutions: int
    holdings: int
    symbols_covered: list[str]
    latest_filing_at: datetime | None = None
    latest_signal_at: datetime | None = None
    signal_engine_version: str
    caveats: list[str] = Field(default_factory=list)


class InsiderTransactionOut(CamelModel):
    id: str
    accession_number: str
    symbol: str
    issuer_name: str
    reporting_person_name: str
    reporting_person_cik: str
    role: str
    transaction_date: datetime | None = None
    transaction_code: str
    classification: str
    is_open_market: bool
    security_title: str
    shares: Decimal | None = None
    price_per_share: Decimal | None = None
    value: Decimal | None = None
    shares_owned_after: Decimal | None = None
    direct_or_indirect: str
    accepted_at: datetime
    is_amendment: bool
    source_url: str
    description: str
    data_quality: str


class InsiderFeedOut(CamelModel):
    items: list[InsiderTransactionOut]
    total: int
    page: int
    limit: int
    has_more: bool


class InsiderSymbolSummaryOut(CamelModel):
    symbol: str
    issuer_name: str
    window_days: int
    purchase_count: int
    sale_count: int
    distinct_purchasers: int
    distinct_sellers: int
    purchase_value_usd: Decimal | None = None
    unpriced_purchase_lines: int
    latest_filing_at: datetime | None = None
    latest_transaction_date: datetime | None = None
    caveats: list[str] = Field(default_factory=list)


class SignalOut(CamelModel):
    id: str
    category: str
    symbol: str
    source_event_ids: list[str]
    event_time: datetime
    public_available_at: datetime
    calculated_at: datetime
    raw_measurement: Decimal
    raw_unit: str
    score: Decimal | None = None
    explanation: str
    data_quality: str
    confidence_notes: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    engine_version: str


class SignalFeedOut(CamelModel):
    items: list[SignalOut]
    total: int
    page: int
    limit: int
    has_more: bool


class InstitutionalHoldingChangeOut(CamelModel):
    cusip: str
    issuer_name: str
    class_title: str
    change_type: str
    current_shares: Decimal | None = None
    prior_shares: Decimal | None = None
    current_value_usd: Decimal | None = None
    prior_value_usd: Decimal | None = None
    share_change: Decimal | None = None
    share_change_pct: Decimal | None = None
    period_of_report: datetime
    prior_period_of_report: datetime | None = None
    public_available_at: datetime
    source_url: str


class InstitutionOut(CamelModel):
    cik: str
    name: str
    periods: list[datetime]
    latest_period: datetime | None = None
    latest_public_available_at: datetime | None = None
    reported_value_usd: Decimal | None = None
    position_count: int
    caveats: list[str] = Field(default_factory=list)


class InstitutionFeedOut(CamelModel):
    items: list[InstitutionOut]
    total: int
    page: int
    limit: int
    has_more: bool


class InstitutionChangesOut(CamelModel):
    cik: str
    name: str
    period_of_report: datetime | None = None
    prior_period_of_report: datetime | None = None
    changes: list[InstitutionalHoldingChangeOut]
    caveats: list[str] = Field(default_factory=list)


class FusionComponentOut(CamelModel):
    name: str
    category: str
    measurement: Decimal
    unit: str
    score: Decimal | None = None
    public_available_at: datetime
    explanation: str
    data_quality: str
    source: str


class FusionOut(CamelModel):
    symbol: str
    as_of: datetime
    components: list[FusionComponentOut]
    composite_score: Decimal | None = None
    coverage: Decimal
    explanation: str
    data_quality: str
    caveats: list[str] = Field(default_factory=list)


class SymbolSummaryOut(CamelModel):
    symbol: str
    as_of: datetime
    insider: InsiderSymbolSummaryOut
    signals: list[SignalOut]
    fusion: FusionOut
    freshness: str
    caveats: list[str] = Field(default_factory=list)


# --- research (intelligence 1.1) ------------------------------------------


class IntelJobOut(CamelModel):
    name: str
    kind: str
    schedule_seconds: int
    enabled: bool
    paused: bool
    status: str
    last_status: str
    last_started_at: datetime | None = None
    last_finished_at: datetime | None = None
    next_run_at: datetime | None = None
    last_error: str
    consecutive_failures: int
    total_runs: int
    total_failures: int
    lease_owner: str | None = None
    lease_expires_at: datetime | None = None
    metrics: dict[str, Any] = Field(default_factory=dict)


class IntelJobFeedOut(CamelModel):
    items: list[IntelJobOut]
    total: int
    scheduler_enabled: bool
    caveats: list[str] = Field(default_factory=list)


class IntelBackfillStreamOut(CamelModel):
    issuer_cik: str
    form_family: str
    status: str
    cursor: datetime | None = None
    window_start: datetime | None = None
    window_end: datetime | None = None
    filings_seen: int
    filings_new: int
    filings_skipped: int
    filings_unavailable: int
    filings_malformed: int
    attempts: int
    last_error: str


class IntelCoverageOut(CamelModel):
    filings: int
    transactions: int
    signals: int
    institutions: int
    holdings: int
    earliest_filing_at: datetime | None = None
    latest_filing_at: datetime | None = None
    earliest_signal_at: datetime | None = None
    latest_signal_at: datetime | None = None
    symbols_covered: list[str]
    identifiers: dict[str, Any]
    backfill: list[IntelBackfillStreamOut]
    price_coverage: dict[str, Any]
    caveats: list[str] = Field(default_factory=list)


class IntelExperimentOut(CamelModel):
    id: str
    name: str
    signal_version: str
    data_version: str
    period_start: datetime
    period_end: datetime
    information_cutoff: datetime
    benchmark: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    execution_assumptions: dict[str, Any] = Field(default_factory=dict)
    cost_assumptions: dict[str, Any] = Field(default_factory=dict)
    sample_size: int
    coverage: dict[str, Any] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)
    status: str
    flags: list[str] = Field(default_factory=list)
    definition_hash: str
    data_fingerprint: str
    created_at: datetime
    completed_at: datetime | None = None
    # A read-only assessment of whether the stored evidence supports the result.
    # Absent on the operator run response, which reports what was just recorded
    # rather than how far it can be trusted.
    forensics: dict[str, Any] | None = None


class IntelExperimentFeedOut(CamelModel):
    items: list[IntelExperimentOut]
    total: int
    caveats: list[str] = Field(default_factory=list)


class QuantLabRunRequest(CamelModel):
    """The window a Quant Lab run covers.

    ``information_cutoff`` defaults to the period end. It exists separately so a
    run can be pinned to what was knowable at a chosen moment, which is what
    makes a later re-run comparable.
    """

    period_start: datetime | None = None
    period_end: datetime | None = None
    information_cutoff: datetime | None = None


class QuantLabRunOut(CamelModel):
    items: list[IntelExperimentOut]
    reproduction: dict[str, str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)


class IntelValidationOut(CamelModel):
    signal_id: str
    category: str
    status: str
    benchmark: str
    cost_bps: Decimal
    sample_size: int
    coverage: dict[str, Any] = Field(default_factory=dict)
    flags: list[str] = Field(default_factory=list)
    overlap: dict[str, Any] = Field(default_factory=dict)
    multiple_testing: dict[str, Any] | None = None
    horizons: list[dict[str, Any]] = Field(default_factory=list)
    splits: list[dict[str, Any]] = Field(default_factory=list)


class IntelBackfillRequest(CamelModel):
    ciks: list[str] = Field(default_factory=list)
    form_family: str = "ownership"
    start_date: str | None = None
    end_date: str | None = None
    max_filings: int | None = Field(default=None, ge=1, le=100_000)


class IntelBackfillOut(CamelModel):
    source: str
    status: str
    streams: int
    completed: int
    failed: int
    paused: int
    filings_seen: int
    filings_new: int
    filings_skipped: int
    filings_unavailable: int
    filings_malformed: int
    stopped_early: bool
    errors: list[dict[str, str]] = Field(default_factory=list)
    progress: list[IntelBackfillStreamOut] = Field(default_factory=list)


# --- member research (customer-safe projection) ---------------------------
#
# These mirror ``lib/api/research-contract.ts``. They carry no collection
# machinery: no job, lease, backfill cursor, retry counter or identifier
# internals. A member reads evidence and how much of the window it covers.


class ResearchSourceLinkOut(CamelModel):
    id: str
    kind: str
    label: str
    url: str
    accession_number: str | None = None
    form_type: str | None = None
    public_available_at: datetime | None = None
    supports: str
    retrieved_at: datetime


class ResearchCoverageGapOut(CamelModel):
    key: str
    label: str
    detail: str


class ResearchCoverageDisclosureOut(CamelModel):
    status: str
    window_start: datetime | None = None
    window_end: datetime | None = None
    symbols_covered: int
    symbols_requested: int
    gaps: list[ResearchCoverageGapOut] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)


class PriceCoverageOut(CamelModel):
    """What daily price history exists for a symbol, and what is missing.

    ``missing_dates`` are trading days the provider did not return. They are
    reported, never filled, so a reader can see the shape of the gap.
    """

    status: str
    provider: str | None = None
    interval: str = "1d"
    bars: int = 0
    first_bar: date | None = None
    last_bar: date | None = None
    window_start: date | None = None
    window_end: date | None = None
    expected_days: int = 0
    stored_days: int = 0
    missing_days: int = 0
    missing_dates: list[str] = Field(default_factory=list)
    adjustment: str | None = None
    retrieved_at: datetime | None = None
    detail: str | None = None


class ResearchCountsOut(CamelModel):
    filings: int
    transactions: int
    signals: int
    institutions: int
    holdings: int
    symbols: int


class ResearchDashboardOut(CamelModel):
    as_of: datetime
    freshness: str
    counts: ResearchCountsOut
    latest_filing_at: datetime | None = None
    latest_signal_at: datetime | None = None
    top_signals: list[SignalOut] = Field(default_factory=list)
    recent_purchases: list[InsiderTransactionOut] = Field(default_factory=list)
    coverage: ResearchCoverageDisclosureOut
    caveats: list[str] = Field(default_factory=list)


class PriceBarOut(CamelModel):
    """One stored daily bar, with the provider and adjustment that produced it."""

    trading_date: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal
    provider: str
    adjustment: str | None = None
    quality: str


class PriceSeriesOut(CamelModel):
    """Recent daily bars for a symbol, and what the series does not cover."""

    symbol: str
    interval: str = "1d"
    provider: str | None = None
    adjustment: str | None = None
    bars: list[PriceBarOut] = Field(default_factory=list)
    coverage: PriceCoverageOut | None = None
    caveats: list[str] = Field(default_factory=list)


class AssetIdentifierOut(CamelModel):
    """A verified claim that a reported CUSIP is this security."""

    cusip: str
    symbol: str
    issuer_name: str = ""
    security_description: str = ""
    share_class: str = ""
    source: str = ""
    verification_status: str
    confidence: Decimal
    effective_from: datetime
    effective_to: datetime | None = None
    notes: str = ""


class AssetHoldingOut(CamelModel):
    """One institution's reported position in the asset, as filed.

    ``period_of_report`` is the quarter end and ``public_available_at`` is when
    the filing became readable. They are never interchangeable: a position is
    only shown once the filing was public.
    """

    institution_cik: str
    institution_name: str
    cusip: str
    class_title: str = ""
    shares: Decimal | None = None
    value_usd: Decimal | None = None
    period_of_report: datetime
    public_available_at: datetime
    share_change: Decimal | None = None
    share_change_pct: Decimal | None = None
    prior_period_of_report: datetime | None = None
    source_url: str = ""
    mapping_status: str
    mapping_source: str = ""


class AssetInstitutionalOut(CamelModel):
    """Institutional ownership of one asset, and what could not be attributed."""

    holdings: list[AssetHoldingOut] = Field(default_factory=list)
    institutions: int = 0
    latest_period: datetime | None = None
    unresolved_holdings: int = 0
    caveats: list[str] = Field(default_factory=list)


class AssetResearchOut(CamelModel):
    symbol: str
    issuer_name: str | None = None
    as_of: datetime
    freshness: str
    insider: InsiderSymbolSummaryOut
    signals: list[SignalOut] = Field(default_factory=list)
    fusion: FusionOut
    sources: list[ResearchSourceLinkOut] = Field(default_factory=list)
    coverage: ResearchCoverageDisclosureOut
    price_coverage: PriceCoverageOut | None = None
    identifier_mappings: list[AssetIdentifierOut] = Field(default_factory=list)
    institutional: AssetInstitutionalOut = Field(default_factory=AssetInstitutionalOut)
    caveats: list[str] = Field(default_factory=list)


__all__ = [
    "AssetHoldingOut",
    "AssetIdentifierOut",
    "AssetInstitutionalOut",
    "AssetResearchOut",
    "PriceBarOut",
    "PriceSeriesOut",
    "FusionComponentOut",
    "FusionOut",
    "InsiderFeedOut",
    "InsiderSymbolSummaryOut",
    "InsiderTransactionOut",
    "InstitutionChangesOut",
    "InstitutionFeedOut",
    "InstitutionOut",
    "InstitutionalHoldingChangeOut",
    "IntelBackfillOut",
    "IntelBackfillRequest",
    "IntelBackfillStreamOut",
    "IntelCoverageOut",
    "IntelExperimentFeedOut",
    "IntelExperimentOut",
    "IntelJobFeedOut",
    "IntelJobOut",
    "IntelSourceStatusOut",
    "IntelStatusOut",
    "IntelValidationOut",
    "ResearchCountsOut",
    "ResearchCoverageDisclosureOut",
    "ResearchCoverageGapOut",
    "ResearchDashboardOut",
    "ResearchSourceLinkOut",
    "SignalFeedOut",
    "SignalOut",
    "SymbolSummaryOut",
]
