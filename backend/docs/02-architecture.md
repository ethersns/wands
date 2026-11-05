# Wands — Architecture

## 1. Deployment topology

```
                    ┌──────────────────────────────┐
   operator ───────▶│  Next.js frontend (Vercel)   │
                    │  - renders UI                │
                    │  - BFF proxy /api/wands/*    │
                    │  - holds WANDS_ENGINE_TOKEN  │
                    └──────────────┬───────────────┘
                                   │ HTTPS + bearer, private network / VPN
                    ┌──────────────▼───────────────┐
                    │  Wands engine (private VPS)  │
                    │  FastAPI + uvicorn           │
                    │  ┌────────────────────────┐  │
                    │  │ API layer (v1)         │  │
                    │  ├────────────────────────┤  │
                    │  │ Risk engine            │  │  ← security critical
                    │  ├────────────────────────┤  │
                    │  │ Execution gateway      │  │  ← only order path
                    │  ├────────────────────────┤  │
                    │  │ Strategy engine        │  │  ← emits intents only
                    │  ├────────────────────────┤  │
                    │  │ Market data / portfolio│  │
                    │  └────────────────────────┘  │
                    └───┬───────────┬───────────┬──┘
                        │           │           │
                 ┌──────▼───┐ ┌─────▼────┐ ┌────▼─────────┐
                 │PostgreSQL│ │  Redis   │ │ Broker APIs  │
                 │ (private)│ │ (private)│ │ (outbound)   │
                 └──────────┘ └──────────┘ └──────────────┘
```

PostgreSQL, Redis and the broker gateway are **never** published to the public
internet. Only the engine's HTTPS listener is reachable, and only from the
frontend's egress and the operator VPN.

## 2. Layering rules (enforced, not aspirational)

The single most important architectural property is that **a strategy cannot
place an order**. This is enforced structurally:

```
strategies/  ──imports──▶  execution/intents.py   (data only)
             ──X──────▶   brokers/               (forbidden)
             ──X──────▶   execution/gateway.py   (forbidden)
             ──X──────▶   sqlalchemy / db        (forbidden)

api/         ──imports──▶  execution/gateway.py
             ──imports──▶  risk/engine.py
             ──X──────▶   brokers/               (forbidden: only the gateway
                                                  may hold broker adapters)
```

`tests/test_strategy_isolation.py` parses the AST of every module under
`wands/strategies/` and fails the build if a forbidden import appears. The rule
is therefore a test, not a comment.

Order flow, end to end:

```
Strategy.propose(ctx) ──▶ TradeIntent (no side effects)
                              │
                              ▼
              ExecutionGateway.submit(intent, principal)
                              │
                    1. mode validation      (live requires explicit enable)
                    2. idempotency          (client_order_id unique)
                    3. RiskEngine.evaluate  (independent, cannot be skipped)
                    4. BrokerAdapter.submit (paper adapter only in this build)
                    5. persist order + fills + audit event
```

There is no other code path that reaches a `BrokerAdapter`.

## 3. Module map

```
backend/wands/
  config.py            pydantic-settings; all env in one place
  logging.py           structured JSON logs, request-id correlation
  telemetry.py         OpenTelemetry wiring (no-op when unconfigured)
  envelope.py          Envelope<T> construction — the frontend contract
  errors.py            typed engine errors → HTTP + error envelope
  schemas.py           camelCase pydantic base + shared enums
  db/
    base.py            DeclarativeBase + constraint naming convention
    session.py         engine/session factory, FastAPI dependency
    models.py          full relational schema
  security/
    auth.py            bearer auth: service token + hashed API keys
    rbac.py            viewer < operator < admin
    totp.py            RFC 6238 TOTP (stdlib only) for MFA
    secrets.py         Fernet encryption of credentials at rest
    audit.py           append-only audit trail
  risk/
    policy.py          RiskPolicy value object + defaults
    engine.py          independent limit evaluation
  execution/
    intents.py         TradeIntent (pure data)
    idempotency.py     client order id derivation + duplicate window
    gateway.py         the only order submission path
  brokers/
    base.py            BrokerAdapter protocol + request/result types
    paper.py           deterministic paper broker
  strategies/
    base.py            Strategy interface (propose() only)
    registry.py        built-in strategy catalogue
  api/
    deps.py            auth/RBAC dependencies, session, request id
    router.py          /v1 router assembly
    routes/*.py        one module per resource
```

## 4. Trading modes

| Mode | Data | Execution | Enabled by default |
| --- | --- | --- | --- |
| `backtest` | historical | simulated, in-process | yes |
| `paper` | live or delayed | simulated / broker paper endpoint | yes |
| `live` | live | real money | **no** |

`live` requires all of:

1. `WANDS_LIVE_TRADING_ENABLED=true` in the process environment (deployment
   level, not a database flag),
2. `engine_state.live_trading_enabled = true` set by an authenticated `admin`
   principal through `POST /v1/engine/live-trading` with an MFA code,
3. an `audit_events` row recording actor, time and request id.

Paper and live credentials are stored on **separate `connections` rows** with
separate `mode` values. Enabling live never reuses a paper connection.

## 5. Failure semantics

- **Unknown execution outcome** (timeout, connection loss after submit): the
  order is persisted as `status = "open"`, `reconciliation = "pending"` and the
  gateway refuses to retry until a reconciliation pass resolves it. Retrying an
  unknown outcome is how duplicate positions are created.
- **Stale market data**: any quote older than `max_quote_age_seconds` blocks new
  risk-increasing orders.
- **Stale account state**: if the last successful broker sync is older than the
  configured threshold, orders are blocked rather than sized against a stale
  balance.
- **Emergency stop** is persisted in `engine_state` and survives restarts. It is
  checked first in the risk engine, before any other rule.

## 6. Observability

- Structured JSON logs on stdout with `request_id`, `principal`, `route`,
  `latency_ms`, `outcome`.
- OpenTelemetry traces/metrics exported over OTLP when
  `WANDS_OTEL_EXPORTER_OTLP_ENDPOINT` is set; otherwise a no-op tracer.
- `GET /v1/engine/status` is the liveness/readiness surface the UI polls.
- `GET /healthz` (liveness) and `GET /readyz` (DB reachable) for the container
  orchestrator.

## 7. What this build does and does not do

Implemented in this phase: configuration, logging, database schema and
migrations, authentication/RBAC/MFA, encrypted credential storage, audit trail,
the independent risk engine, the paper execution gateway with idempotency, the
strategy interface and registry, and the full `/v1` read surface backed by real
database state.

Not implemented (returns `501 not_implemented`, never fake data): market data
ingestion, candle history, backtest execution, live broker adapters, the AI
research engine. The frontend already handles this correctly by falling back to
`provenance: "demo"` fixtures with a visible warning.
