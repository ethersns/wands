"""FastAPI application factory.

Middleware order matters: the request id is assigned first so that every log
line and every error response can be correlated with the audit trail.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from wands.api.deps import client_ip
from wands.api.router import api_router
from wands.bootstrap import bootstrap
from wands.config import Settings, get_settings
from wands.db.base import Base
from wands.db.session import get_engine, session_scope
from wands.envelope import envelope
from wands.errors import EngineError, Forbidden, Unauthorized
from wands.intelligence.jobs import JobScheduler
from wands.logging import configure_logging, get_logger
from wands.marketdata.worker import MarketDataWorker
from wands.security.audit import note_denial, record_denial
from wands.telemetry import configure_telemetry

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    configure_logging(settings.log_level)
    configure_telemetry(settings)

    if settings.is_production and settings.is_sqlite:
        # A production host pointed at SQLite would create an empty database and
        # then serve it as though it were real state. Refuse rather than start
        # healthy and wrong.
        raise RuntimeError(
            "Refusing to start: WANDS_DATABASE_URL points at SQLite in production. "
            "A production host must use PostgreSQL."
        )

    if settings.is_sqlite:
        # Development and tests only. Production runs `alembic upgrade head`.
        Base.metadata.create_all(bind=get_engine())

    with session_scope() as session:
        bootstrap(session)

    worker: MarketDataWorker | None = None
    if settings.market_data_worker_enabled and settings.environment != "test":
        worker = MarketDataWorker(
            interval_seconds=settings.market_refresh_seconds,
            watchlist=settings.watchlist,
            candle_limit=settings.market_candle_limit,
        )
        worker.start()

    scheduler: JobScheduler | None = None
    if settings.intelligence_jobs_enabled and settings.environment != "test":
        scheduler = JobScheduler(settings)
        # Reclaim any job whose lease outlived the process that held it before
        # scheduling anything new, so an interrupted crawl is visible rather
        # than silently skipped.
        scheduler.recover()
        scheduler.ensure_jobs()
        scheduler.start()

    logger.info(
        "engine started",
        extra={
            "event": "engine.start",
            "context": {
                "environment": settings.environment,
                "mode": settings.trading_mode,
                "liveTradingEnabled": settings.live_trading_enabled,
                "marketDataWorker": worker is not None,
                "intelligenceJobs": scheduler is not None,
            },
        },
    )
    yield
    if scheduler is not None:
        scheduler.stop()
    if worker is not None:
        worker.stop()
    logger.info("engine stopped", extra={"event": "engine.stop"})


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    app = FastAPI(
        title="Wands Engine",
        version=settings.version,
        description=(
            "Private algorithmic trading engine. Every response is wrapped in the "
            "Envelope shape consumed by the Wands frontend."
        ),
        lifespan=lifespan,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
    )
    app.state.settings = settings

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["authorization", "content-type", "x-wands-mfa-code", "x-request-id"],
        )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        request.state.request_id = request_id
        started = time.perf_counter()

        response = await call_next(request)

        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        response.headers["x-request-id"] = request_id
        logger.info(
            "request",
            extra={
                "event": "http.request",
                "request_id": request_id,
                "method": request.method,
                "route": request.url.path,
                "status": response.status_code,
                "latency_ms": elapsed_ms,
            },
        )
        return response

    @app.exception_handler(EngineError)
    async def engine_error_handler(request: Request, exc: EngineError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        if exc.status_code >= 500:
            logger.error(
                "engine error",
                extra={
                    "event": "http.error",
                    "request_id": request_id,
                    "route": request.url.path,
                    "context": {"code": exc.code, "message": exc.message},
                },
            )
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.to_payload()},
            headers={"x-request-id": request_id} if request_id else None,
        )

    @app.exception_handler(Forbidden)
    def forbidden_handler(request: Request, exc: Forbidden) -> JSONResponse:
        """Audit an authenticated permission denial, then deny it.

        Registered as a sync handler so the audit write runs in the threadpool
        rather than blocking the event loop. ``MfaRequired`` subclasses
        ``Forbidden``, so a missing second factor is recorded here too. The
        response is unchanged: a denial is still a denial even if the audit
        store is down.
        """
        request_id = getattr(request.state, "request_id", None)
        principal = getattr(request.state, "principal", None)
        # The concrete path, not the route template: the template drops the
        # router prefix, and the exact resource is what an investigation needs.
        target = f"{request.method} {request.url.path}"[:120]

        if principal is not None:
            record_denial(
                actor=principal.subject,
                actor_type="service" if principal.is_service else "user",
                target=target,
                detail={"code": exc.code, "reason": exc.message, "role": str(principal.role)},
                request_id=request_id,
                ip=client_ip(request),
            )
        note_denial(exc.code)
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.to_payload()},
            headers={"x-request-id": request_id} if request_id else None,
        )

    @app.exception_handler(Unauthorized)
    def unauthorized_handler(request: Request, exc: Unauthorized) -> JSONResponse:
        """Count and log an unauthenticated rejection without persisting it.

        There is no principal to name and the caller controls the retry rate, so
        these are aggregated in memory and logged for alerting instead of being
        written to the durable audit trail.
        """
        request_id = getattr(request.state, "request_id", None)
        note_denial("unauthorized")
        logger.warning(
            "unauthenticated request rejected",
            extra={
                "event": "auth.rejected",
                "request_id": request_id,
                "route": request.url.path,
                "context": {"ip": client_ip(request)},
            },
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.to_payload()},
            headers={"x-request-id": request_id} if request_id else None,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "bad_request",
                    "message": "The request body or query is invalid.",
                    "details": [
                        {"location": list(err.get("loc", [])), "message": err.get("msg", "")}
                        for err in exc.errors()
                    ],
                }
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        logger.exception(
            "unhandled error",
            extra={"event": "http.unhandled", "request_id": request_id, "route": request.url.path},
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "engine_error",
                    "message": "The engine failed to process this request.",
                    "requestId": request_id,
                }
            },
        )

    @app.get("/healthz", tags=["operations"])
    def healthz() -> dict:
        return envelope({"status": "ok", "version": settings.version})

    @app.get("/readyz", tags=["operations"])
    def readyz() -> JSONResponse:
        try:
            with session_scope() as session:
                session.execute(text("SELECT 1"))
        except Exception as exc:  # noqa: BLE001 - readiness must never raise
            return JSONResponse(
                status_code=503,
                content={
                    "error": {
                        "code": "engine_error",
                        "message": f"Database is not reachable: {type(exc).__name__}",
                    }
                },
            )
        return JSONResponse(status_code=200, content=envelope({"status": "ready"}))

    app.include_router(api_router)
    return app


app = create_app()
