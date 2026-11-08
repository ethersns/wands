"""Opportunity Desk: private, manual research on short-term setups.

This package produces research candidates and records what the founder decided
about them. It has no order path: nothing here imports the execution gateway,
the paper broker or the risk engine, and no function returns an executable
instruction. A candidate is a hypothesis to look at, not a trade.
"""

from wands.opportunity.candidates import (
    Candidate,
    CandidateReport,
    Costs,
    DataQuality,
    OpportunityDesk,
    ResearchBudget,
    Sizing,
    Skipped,
    estimate_costs,
    size_position,
)
from wands.opportunity.journal import (
    CANDIDATE_GENERATED,
    CANDIDATE_REJECTED,
    CANDIDATE_WATCHED,
    ENTRY_NOT_TRIGGERED,
    INSUFFICIENT_DATA,
    TEST_ACTIVE,
    TEST_COMPLETED,
    TEST_EXPIRED,
    TEST_INVALIDATED,
    PaperTest,
    TestOutcome,
    evaluate_test,
)
from wands.opportunity.strategy import (
    STRATEGY_KEY,
    STRATEGY_NAME,
    STRATEGY_VERSION,
    BreakoutParameters,
    BreakoutSignal,
    IntradayBreakout,
)
from wands.opportunity.watchlist import (
    DEFAULT_WATCHLIST,
    WatchlistEntry,
    holding_deadline,
    in_session,
    session_close,
)

__all__ = [
    "CANDIDATE_GENERATED",
    "CANDIDATE_REJECTED",
    "CANDIDATE_WATCHED",
    "DEFAULT_WATCHLIST",
    "ENTRY_NOT_TRIGGERED",
    "INSUFFICIENT_DATA",
    "STRATEGY_KEY",
    "STRATEGY_NAME",
    "STRATEGY_VERSION",
    "TEST_ACTIVE",
    "TEST_COMPLETED",
    "TEST_EXPIRED",
    "TEST_INVALIDATED",
    "BreakoutParameters",
    "BreakoutSignal",
    "Candidate",
    "CandidateReport",
    "Costs",
    "DataQuality",
    "IntradayBreakout",
    "OpportunityDesk",
    "PaperTest",
    "ResearchBudget",
    "Sizing",
    "Skipped",
    "TestOutcome",
    "WatchlistEntry",
    "estimate_costs",
    "evaluate_test",
    "holding_deadline",
    "in_session",
    "session_close",
    "size_position",
]
