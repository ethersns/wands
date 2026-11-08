# Wands engine image.
#
# Runs as a non-root user, installs only runtime dependencies, and does NOT
# migrate on start. Migrations are a separate, explicit step (the `migrate`
# service in docker-compose.yml) so that a restart can never apply a schema
# change nobody asked for.
#
# The base image is pinned to a patch release. For a fully reproducible build,
# pin by digest instead:
#   docker pull python:3.12.8-slim-bookworm
#   docker inspect --format='{{index .RepoDigests 0}}' python:3.12.8-slim-bookworm
# then replace the FROM line with `python:3.12.8-slim-bookworm@sha256:...`.

FROM python:3.12.8-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore

WORKDIR /app

# curl is only here for the container healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY wands ./wands
RUN pip install --no-cache-dir .

COPY alembic.ini ./
COPY alembic ./alembic
COPY scripts ./scripts

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin wands \
    && chown -R wands:wands /app

USER wands

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/healthz" || exit 1

# --forwarded-allow-ips defaults to loopback, not '*'. The engine records the
# client IP in the audit trail from X-Forwarded-For, so trusting that header
# from an arbitrary peer would let a caller forge the address in the trail.
# Set WANDS_FORWARDED_ALLOW_IPS to the reverse proxy's address when the proxy
# is not on the same host.
#
# One worker on purpose: the in-process job scheduler and market-data worker
# start in the lifespan, so a second worker would run a second scheduler.
# PORT is honoured because managed hosts (Railway, Render, Fly) inject it and
# route only to the port they assigned. 8000 stays the default so the
# docker-compose setup is unchanged.
CMD ["sh", "-c", "exec uvicorn wands.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips=${WANDS_FORWARDED_ALLOW_IPS:-127.0.0.1}"]
