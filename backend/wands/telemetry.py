"""OpenTelemetry wiring.

Export is opt-in: with no OTLP endpoint configured the engine runs with a no-op
tracer and says so in the log, rather than silently dropping spans and leaving
an operator to believe they are being collected.
"""

from __future__ import annotations

from wands.config import Settings
from wands.logging import get_logger

logger = get_logger(__name__)


def configure_telemetry(settings: Settings) -> bool:
    endpoint = (settings.otel_exporter_otlp_endpoint or "").strip()
    if not endpoint:
        logger.info(
            "telemetry disabled: no OTLP endpoint configured",
            extra={"event": "telemetry.disabled"},
        )
        return False

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        logger.warning(
            "telemetry requested but the OpenTelemetry SDK is not installed",
            extra={"event": "telemetry.unavailable"},
        )
        return False

    provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": settings.service_name,
                "service.version": settings.version,
                "deployment.environment": settings.environment,
            }
        )
    )
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
    trace.set_tracer_provider(provider)

    logger.info(
        "telemetry enabled",
        extra={"event": "telemetry.enabled", "context": {"endpoint": endpoint}},
    )
    return True
