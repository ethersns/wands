"""Performance Lab: private evidence capture and validation.

The package records signals before their outcome is known, evaluates them with
deterministic arithmetic against subsequently observed bars, and stores the
result as immutable evidence. It does not place orders and does not import the
order path.
"""

from wands.performance.evaluation import HorizonResult, SignalEvaluator
from wands.performance.evidence import EvidenceVault
from wands.performance.horizons import DEFAULT_HORIZONS, Horizon, resolve_horizons
from wands.performance.service import PerformanceLab
from wands.performance.signals import RecordOutcome, SignalInput, SignalRecorder

__all__ = [
    "DEFAULT_HORIZONS",
    "EvidenceVault",
    "Horizon",
    "HorizonResult",
    "PerformanceLab",
    "RecordOutcome",
    "SignalEvaluator",
    "SignalInput",
    "SignalRecorder",
    "resolve_horizons",
]
