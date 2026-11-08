"""Evaluation horizons.

A horizon is a claim about when an outcome becomes knowable. The intraday
horizons are declared here because the product asks for them, but the engine
stores daily bars, so an intraday horizon is reported as unsupported rather than
approximated from a daily close. Approximating it would produce a number that
looks like evidence and is not.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class Horizon:
    label: str
    trading_days: int
    intraday: bool = False


DEFAULT_HORIZONS: tuple[Horizon, ...] = (
    Horizon("1h", 0, intraday=True),
    Horizon("4h", 0, intraday=True),
    Horizon("1d", 1),
    Horizon("5d", 5),
    Horizon("20d", 20),
)

_BY_LABEL = {horizon.label: horizon for horizon in DEFAULT_HORIZONS}


def resolve_horizons(labels: Sequence[str] | None) -> list[Horizon]:
    if not labels:
        return list(DEFAULT_HORIZONS)
    resolved: list[Horizon] = []
    for label in labels:
        horizon = _BY_LABEL.get(label)
        if horizon is None:
            supported = ", ".join(sorted(_BY_LABEL))
            raise ValueError(f"Unknown horizon {label!r}. Supported horizons: {supported}.")
        if horizon not in resolved:
            resolved.append(horizon)
    return resolved
