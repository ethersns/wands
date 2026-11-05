"""Typed engine errors.

Each error carries the HTTP status and the machine-readable code the frontend
already understands (see ``lib/api/browser.ts``). Handlers translate these into
the ``{"error": {...}}`` shape; anything unhandled becomes ``engine_error`` with
a request id so the operator can find the traceback in the logs without the
client ever seeing it.
"""

from __future__ import annotations

from typing import Any


class EngineError(Exception):
    code: str = "engine_error"
    status_code: int = 500

    def __init__(self, message: str, *, details: list[dict[str, Any]] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or []

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            payload["details"] = self.details
        return payload


class Unauthorized(EngineError):
    code = "unauthorized"
    status_code = 401


class Forbidden(EngineError):
    code = "forbidden"
    status_code = 403


class MfaRequired(Forbidden):
    code = "mfa_required"


class NotFound(EngineError):
    code = "not_found"
    status_code = 404


class BadRequest(EngineError):
    code = "bad_request"
    status_code = 422


class Conflict(EngineError):
    code = "conflict"
    status_code = 409


class RiskRejected(EngineError):
    code = "risk_rejected"
    status_code = 422


class LiveTradingDisabled(EngineError):
    code = "live_trading_disabled"
    status_code = 403


class NotImplementedYet(EngineError):
    """A capability that is deliberately not built yet.

    Returning this is the honest alternative to inventing data. The frontend
    falls back to fixtures tagged ``provenance: "demo"`` and shows a warning.
    """

    code = "not_implemented"
    status_code = 501
