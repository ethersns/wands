# Wands Engine

Private algorithmic trading engine for the Wands platform. Python 3.12,
FastAPI, PostgreSQL, SQLAlchemy + Alembic, Redis, Docker.

The Next.js frontend in the repository root is the contract this service
implements: every response is an `Envelope<T>` matching
`lib/api/contracts.ts`, and the browser never holds an engine credential.

## Quick start

```bash
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"          # WANDS_ENGINE_TOKEN
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # WANDS_ENCRYPTION_KEY

# Development database (SQLite is accepted only outside production)
export WANDS_DATABASE_URL="sqlite:///./wands-dev.db"
alembic upgrade head
uvicorn wands.main:app --reload
```

Then point the frontend at it:

```
WANDS_ENGINE_URL=http://127.0.0.1:8000
WANDS_ENGINE_TOKEN=<the token you generated>
```

## Tests

```bash
pytest
```

304 tests covering authentication and RBAC, MFA, the envelope contract, every
risk limit, duplicate-order prevention, emergency-stop persistence across a
restart, paper/live separation, strategy isolation (AST-enforced), credential
encryption, TOTP against the RFC 6238 vectors, migration
upgrade/downgrade/upgrade, the Phase 3 surface (provider failures, stale quotes,
missing prices, market closures, FX conversion, portfolio valuation, reserved
capital, duplicate candle prevention, restart recovery, paper/live isolation),
and the Intelligence surface: filing parsing, transaction classification,
amendments, duplicate filings, missing transaction prices, SEC acceptance
timestamps, insider clustering, 13F reporting delay, signal calculation,
point-in-time correctness, API authentication, pagination and the
research/execution import boundary.

No test reaches a live venue, the SEC, or places an order. Provider responses
come from `tests/marketdata_fakes.py` and `tests/intelligence_fakes.py`.

## Layout

```
wands/
  config.py        all environment variables, in one place
  logging.py       structured JSON logs with credential redaction
  envelope.py      the Envelope<T> contract
  errors.py        typed errors -> HTTP + error envelope
  schemas.py       camelCase wire models mirroring lib/api/contracts.ts
  db/              models, session, declarative base
  security/        auth, RBAC, TOTP, Fernet secret box, audit trail
  risk/            independent risk engine + policy + RiskContext assembly
  execution/       trade intents, idempotency, the execution gateway
  brokers/         adapter protocol + deterministic paper broker
  marketdata/      provider protocol, Kraken + Alpaca adapters, calendar,
                   rate limiting, ingestion service and refresh worker
  portfolio/       Decimal money helpers, FX snapshots, balances, positions,
                   P&L, equity snapshots and ledger reconciliation
  strategies/      strategy interface + catalogue (no broker access)
  intelligence/    SEC EDGAR collectors, ownership parsing, insider signals,
                   13F radar, signal fusion and freshness (no broker access)
  api/             /v1 routes
alembic/           migrations
docs/              audit, architecture, schema, contracts, threat model, plan,
                   ops, intelligence
```

## Safety properties

- **Live trading is off.** It requires a deployment flag, a database flag, an
  authenticated admin with MFA, and an audit row. All four.
- **The risk engine cannot be skipped.** `ExecutionGateway` calls it
  unconditionally; there is no alternate order path.
- **A strategy cannot place an order.** `wands/strategies/**` may not import a
  broker, the gateway or the database — enforced by a test, not a comment.
- **Unknown outcomes are not retried.** A broker timeout persists the order as
  `reconciliation = pending` and refuses a retry until it is reconciled.
- **Emergency stop survives restarts.** It lives in the database, not in memory.
- **Nothing is fabricated.** Capabilities that do not exist return `501`; the
  frontend then shows fixtures labelled `provenance: "demo"`.
- **Delayed data is never called live.** Every quote carries `quality` and an
  `ageSeconds` measured from the provider's own timestamp. `executablePrice` is
  `null` unless a two-sided quote exists inside the freshness policy — a candle
  close is never treated as an executable price.
- **Money is `Decimal`.** No monetary quantity is computed in floating point.
- **Paper cannot become live.** `paper_accounts.provenance` is always
  `paper_simulated`; no code path promotes it, and positions carry `source` so a
  simulated holding is never shown as broker-confirmed.

## Market data

Kraken public market data needs no credentials and is enabled by default.
Alpaca stock data requires `WANDS_ALPACA_DATA_KEY` / `WANDS_ALPACA_DATA_SECRET`;
without them the engine reports stocks as `unavailable` rather than inventing
prices. Set `WANDS_ALPACA_DATA_DELAYED=true` when the account is not entitled to
real-time SIP so the feed is labelled `delayed`.

The refresh worker runs inside the API process
(`WANDS_MARKET_DATA_WORKER_ENABLED`). Set it to `false` and drive ingestion with
`POST /v1/markets/refresh` from a scheduler if you prefer to separate the two.

## What is not implemented

The backtester, live broker adapters (Kraken/Alpaca/Interactive Brokers order
routing), the reconciliation worker, and the AI research engine. See
`docs/06-implementation-plan.md` for the phase plan.
