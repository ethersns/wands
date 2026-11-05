"""Retry and rate limiting for public data sources.

SEC fair access is a published limit, not a suggestion. Every request goes
through a token bucket, and only transport failures and explicit rate limits are
retried — a malformed document is not retried, because the same request will
produce the same bad answer.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass

from wands.intelligence.base import (
    IntelError,
    SourceDataError,
    SourceNotConfigured,
    SourceRateLimited,
    SourceUnavailable,
)
from wands.marketdata.rate_limit import TokenBucket

RETRYABLE: tuple[type[IntelError], ...] = (SourceUnavailable, SourceRateLimited)
NON_RETRYABLE: tuple[type[IntelError], ...] = (SourceNotConfigured, SourceDataError)


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 3
    base_delay_seconds: float = 1.0
    max_delay_seconds: float = 16.0

    def delay_for(self, attempt: int) -> float:
        return min(self.base_delay_seconds * (2**attempt), self.max_delay_seconds)


def call_with_retry[T](
    operation: Callable[[], T],
    *,
    policy: RetryPolicy,
    sleep: Callable[[float], None] = time.sleep,
    on_retry: Callable[[int, IntelError, float], None] | None = None,
) -> T:
    last: IntelError | None = None
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
            if isinstance(exc, SourceRateLimited) and exc.retry_after_seconds is not None:
                delay = max(delay, exc.retry_after_seconds)
            if on_retry is not None:
                on_retry(attempt, exc, delay)
            sleep(delay)
    assert last is not None
    raise last


__all__ = ["RetryPolicy", "TokenBucket", "call_with_retry"]
