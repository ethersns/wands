"""Market-intelligence subsystem.

Public-data research only. This package has no import path to the broker,
execution or risk modules, so a research signal cannot place an order even by
accident.
"""

from __future__ import annotations

from wands.intelligence.base import (
    FilingRef,
    IntelError,
    IntelQuality,
    ParsedFiling,
    ParsedHolding,
    ParsedInstitutionalFiling,
    ParsedTransaction,
    ReportingOwner,
    SignalCategory,
    SignalDraft,
    SourceDataError,
    SourceNotConfigured,
    SourceRateLimited,
    SourceUnavailable,
    TransactionClass,
)

__all__ = [
    "FilingRef",
    "IntelError",
    "IntelQuality",
    "ParsedFiling",
    "ParsedHolding",
    "ParsedInstitutionalFiling",
    "ParsedTransaction",
    "ReportingOwner",
    "SignalCategory",
    "SignalDraft",
    "SourceDataError",
    "SourceNotConfigured",
    "SourceRateLimited",
    "SourceUnavailable",
    "TransactionClass",
]
