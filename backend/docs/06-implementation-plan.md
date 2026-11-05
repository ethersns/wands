# Wands — Implementation Plan

## Phase status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Repository audit, architecture, schema, API contracts, threat model | **done** (this document set) |
| 2 | Database, FastAPI app, authentication, configuration | **done** |
| 3 | Market data ingestion, portfolio service, risk-engine wiring, paper initialisation | **done** |
| 4 | Independent risk engine, paper execution gateway | **done** (pulled forward — the risk engine is a prerequisite for any order path, so it ships with Phase 2 rather than after it) |
| 5 | Crypto and stock paper adapters | paper adapter done; Kraken/Alpaca adapters not started |
| 6 | Backtesting and strategy modules | strategy interface + registry done; backtester not started |
| 7 | Frontend integration, AI research endpoints | read surface integrated; AI research not started |
| 8 | Cloud deployment, security testing, monitoring | Docker/Compose + ops docs done; monitoring stack not deployed |
| 9 | Live trading readiness | **not started, and live trading is not activated** |

## Phase 2 — what was built

Files created under `backend/`:

```
pyproject.toml                     dependencies, pytest + ruff config
alembic.ini                        migration config
alembic/env.py                     reads WANDS_DATABASE_URL
alembic/versions/0001_initial.py   full schema
wands/config.py                    pydantic-settings, all env in one place
wands/logging.py                   JSON logs, request-id correlation, redaction
wands/telemetry.py                 OpenTelemetry wiring (no-op when unset)
wands/envelope.py                  Envelope<T> construction
wands/errors.py                    typed errors → HTTP + error envelope
wands/schemas.py                   camelCase base model, shared enums
wands/state.py                     engine-state and active-policy accessors
wands/runtime.py                   process uptime
wands/bootstrap.py                 idempotent startup seeding
wands/db/base.py                   DeclarativeBase + naming convention
wands/db/session.py                engine/session factory
wands/db/models.py                 all tables
wands/security/auth.py             service token + hashed API keys
wands/security/rbac.py             viewer/operator/admin
wands/security/totp.py             RFC 6238 TOTP, stdlib only
wands/security/secrets.py          Fernet credential encryption
wands/security/audit.py            append-only audit trail
wands/risk/policy.py               policy value object + defaults
wands/risk/engine.py               independent limit evaluation
wands/execution/intents.py         TradeIntent (pure data)
wands/execution/idempotency.py     client order id + duplicate window
wands/execution/gateway.py         the only order submission path
wands/brokers/base.py              BrokerAdapter protocol
wands/brokers/paper.py             deterministic paper broker
wands/strategies/base.py           Strategy interface (propose only)
wands/strategies/registry.py       built-in catalogue
wands/api/deps.py                  auth/RBAC/session dependencies
wands/api/router.py                /v1 assembly
wands/api/routes/*.py              one module per resource
wands/main.py                      app factory, middleware, lifespan
tests/*.py                         the required safety tests
Dockerfile, docker-compose.yml     deployment
.env.example                       environment template
docs/*.md                          this document set
```

## Phase 3 — what was built

### Market data (`wands/marketdata/`)

| File | Purpose |
| --- | --- |
| `base.py` | `MarketDataProvider` protocol, `Quote`/`Candle` value objects, typed provider errors |
| `symbols.py` | symbol normalisation (`btcusd` → `BTC/USD`, `aapl` → `AAPL`) and market-type inference |
| `calendar.py` | crypto 24/7 plus US equity sessions and holidays; drives `session` on every quote |
| `rate_limit.py` | token-bucket limiter and `call_with_retry` with exponential backoff and jitter |
| `kraken.py` | Kraken public REST adapter — ticker and OHLC, no credentials required |
| `alpaca.py` | Alpaca market-data adapter — IEX or SIP feed, `delayed` flag honoured |
| `service.py` | orchestration: fetch, normalise, freshness-check, persist, serve |
| `worker.py` | background refresh loop on `WANDS_MARKET_REFRESH_SECONDS` |

Persistence is idempotent: `market_candles` is unique on
`(provider, symbol, interval, open_time)` and `market_quotes` on
`(provider, symbol, provider_timestamp)`, so a re-fetch updates rather than
duplicates. Freshness is measured from the **provider** timestamp, never from
`ingested_at`.

### Portfolio (`wands/portfolio/`)

| File | Purpose |
| --- | --- |
| `money.py` | `Decimal` helpers; quantisation and rounding rules in one place |
| `fx.py` | stored FX snapshots with an age limit; no inversion or interpolation at read time |
| `service.py` | balances, positions, reserved capital, buying power, realised/unrealised P&L, fees, equity snapshots, ledger reconciliation |

Every monetary quantity is `Decimal`. Positions carry `source`
(`broker_confirmed` or `paper_simulated`) and per-position price freshness, so a
paper position can never be presented as broker-confirmed.

### Risk-engine wiring (`wands/risk/context.py`)

The engine now receives a `RiskContext` built from the portfolio and market-data
services: verified equity, account-state age, buying power, position exposure,
quote age, bid/ask spread, symbol permissions, market hours, allocation and the
persisted emergency stop. The fail-closed rule is unchanged — a missing or
untrusted field still rejects the order, and no default is substituted to make
an order pass.

### Paper initialisation

`POST /v1/paper/accounts` and `.../reset` create simulated capital with an
explicit currency, write `paper_accounts` plus an audit row, and record an
`initialisation`/`reset` entry in `portfolio_ledger`. There is no code path that
promotes a paper account to live.

### Tests

`tests/test_marketdata.py`, `test_portfolio.py`, `test_risk_integration.py` and
`test_phase3_api.py` cover provider failures, stale quotes, missing prices,
market closures, FX conversion, valuation, reserved capital, duplicate candle
prevention, restart recovery and paper/live isolation. All provider responses
are deterministic fakes (`tests/marketdata_fakes.py`); no test reaches a live
venue or places an order.

## Phase 4 — remaining work

The risk engine and gateway exist and are tested. Still to add:

- Reconciliation worker: sweep `orders` with `reconciliation = 'pending'` and
  resolve against the broker before any retry.
- Rate-limit/backoff policy per provider.
- Partial-fill accounting into `positions`.

## Phase 5 — next stage

- `KrakenAdapter` (paper + live, live gated), `AlpacaAdapter` (paper endpoint
  first), `InteractiveBrokersAdapter` (explicit `degraded` state on gateway
  disconnect).
- Each adapter must declare `supports_live` and refuse live submission unless
  the engine state allows it.

## Phase 6 — next stage

- Event-driven backtester: bar-by-bar loop, fees, spread, slippage, latency,
  partial fills, market closures, splits/dividends, survivorship-bias-free
  universe, walk-forward and out-of-sample splits, Monte Carlo.
- Metrics module producing the full metric set in `BacktestMetrics` plus
  Sortino, expectancy, turnover, exposure.
- A rejection rule: fewer than N trades or a walk-forward verdict of `failed`
  marks the result as not deployable.

## Phase 7 — next stage

- DeepSeek research endpoint with constrained structured output, server-side
  only, no tool access to the gateway or the database.
- SSE stream for operational updates.

## Phase 8 — next stage

- Prometheus/Grafana or an OTLP collector, alert rules on
  `emergency_stop_engaged`, `reconciliation = pending` age, feed staleness and
  daily-loss breach.
- Encrypted `pg_dump` backups with a tested restore procedure.
- Dependency scanning (`pip-audit`) in CI.

## Phase 9 — live readiness (deliberately not done)

Live trading stays disabled. Enabling it requires, in order: a completed
reconciliation worker, a live adapter with verified idempotency against the
broker's own order ids, a documented kill-switch drill, and an explicit
operator decision recorded in the audit log. None of that exists yet, so
`live_trading_enabled` remains `false` and `POST /v1/engine/live-trading`
refuses unless the deployment flag is also set.
