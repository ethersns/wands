"""Rate limiting and exponential backoff.

Public market-data endpoints are shared infrastructure. Hammering one after a
failure is how an IP gets banned, so every provider call goes through a token
bucket and a bounded retry with exponential backoff.

Only transport failures and explicit rate limits are retried. A malformed
payload is not retried: repeating the same request produces the same bad answer
and just burns the budget.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field

from wands.marketdata.base import (
    MarketDataError,
    ProviderDataError,
    ProviderNotConfigured,
    ProviderRateLimited,
    ProviderUnavailable,
)

RETRYABLE: tuple[type[MarketDataError], ...] = (ProviderUnavailable, ProviderRateLimited)
NON_RETRYABLE: tuple[type[MarketDataError], ...] = (ProviderNotConfigured, ProviderDataError)


@dataclass
class TokenBucket:
    """A simple monotonic-clock token bucket.

    ``rate_per_second`` is the refill rate and ``burst`` the maximum stored
    tokens. ``now`` is injected so tests never sleep.
    """

    rate_per_second: float
    burst: int
    _tokens: float = field(init=False, default=0.0)
    _updated_at: float = field(init=False, default=0.0)
    _started: bool = field(init=False, default=False)

    def __post_init__(self) -> None:
        self._tokens = float(self.burst)

    def _refill(self, now: float) -> None:
        if not self._started:
            self._updated_at = now
            self._started = True
            return
        elapsed = max(0.0, now - self._updated_at)
        self._tokens = min(float(self.burst), self._tokens + elapsed * self.rate_per_second)
        self._updated_at = now

    def try_acquire(self, now: float, cost: float = 1.0) -> bool:
        self._refill(now)
        if self._tokens >= cost:
            self._tokens -= cost
            return True
        return False

    def retry_after(self, now: float, cost: float = 1.0) -> float:
        self._refill(now)
        if self._tokens >= cost:
            return 0.0
        if self.rate_per_second <= 0:
            return float("inf")
        return (cost - self._tokens) / self.rate_per_second


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 3
    base_delay_seconds: float = 0.5
    max_delay_seconds: float = 8.0

    def delay_for(self, attempt: int) -> float:
        """Exponential backoff, capped. ``attempt`` is zero-based."""
        return min(self.base_delay_seconds * (2**attempt), self.max_delay_seconds)


def call_with_retry[T](
    operation: Callable[[], T],
    *,
    policy: RetryPolicy,
    sleep: Callable[[float], None] = time.sleep,
    on_retry: Callable[[int, MarketDataError, float], None] | None = None,
) -> T:
    last: MarketDataError | None = None
    for attempt in range(policy.max_attempts):
        try:
            return operation()
        except NON_RETRYABLE:
            raise
        except RETRYABLE as exc:
            last = exc
            if attempt == policy.max_attempts - 1:
                break
            delay = policy.delay_for(attempt)
            if isinstance(exc, ProviderRateLimited) and exc.retry_after_seconds is not None:
                delay = max(delay, exc.retry_after_seconds)
            if on_retry is not None:
                on_retry(attempt, exc, delay)
            sleep(delay)
    assert last is not None
    raise last
