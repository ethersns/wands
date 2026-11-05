"""Structured JSON logging.

Logs are the only durable record of what the engine did at runtime, so they are
machine-readable and redacted by construction: a value whose key looks like a
credential is replaced before it is serialised, rather than relying on every
call site to remember.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

REDACTED = "[redacted]"

_SENSITIVE_FRAGMENTS = (
    "authorization",
    "password",
    "secret",
    "token",
    "api_key",
    "apikey",
    "credential",
    "private_key",
    "mfa",
    "key_hash",
    "cookie",
)

_CONTEXT_FIELDS = (
    "event",
    "request_id",
    "principal",
    "actor_type",
    "route",
    "method",
    "status",
    "latency_ms",
    "outcome",
    "mode",
    "symbol",
    "order_id",
    "client_order_id",
    "violations",
)


def _is_sensitive(key: str) -> bool:
    lowered = key.lower()
    return any(fragment in lowered for fragment in _SENSITIVE_FRAGMENTS)


def redact(value: Any) -> Any:
    """Recursively replace credential-looking values."""
    if isinstance(value, dict):
        return {k: (REDACTED if _is_sensitive(str(k)) else redact(v)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        for field in _CONTEXT_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value

        context = getattr(record, "context", None)
        if isinstance(context, dict):
            payload["context"] = redact(context)

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str, separators=(",", ":"))


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # uvicorn installs its own handlers; route them through ours so every line
    # in the container log is the same shape.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
