"""Wire schemas for the intelligence API.

These mirror the intelligence section of ``lib/api/contracts.ts`` field for
field. The frontend is the contract, so the models are camelCase on the wire and
snake_case in Python, exactly like the rest of the engine.
"""

from __future__ import annotations

from datetime import datetime
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


class IntelExperimentFeedOut(CamelModel):
    items: list[IntelExperimentOut]
    total: int
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


__all__ = [
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
    "SignalFeedOut",
    "SignalOut",
    "SymbolSummaryOut",
]
