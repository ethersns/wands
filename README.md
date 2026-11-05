# Wands

A self-owned algorithmic trading platform for crypto, stocks and ETFs.

Two deployables in one repository:

| Path | What it is | Runs on |
| --- | --- | --- |
| `/` | Next.js 16 frontend — dashboard, portfolio, markets, strategy lab, bots, orders, risk, connections, research, settings | Vercel |
| `/backend` | Python 3.12 trading engine — FastAPI, PostgreSQL, Redis, risk engine, execution gateway | Private VPS (Docker) |

The frontend never talks to an exchange and never holds an engine credential.
Every figure it renders comes from the engine wrapped in an `Envelope<T>` that
carries a `provenance` field, so a demonstration value can never be mistaken for
a real balance.

## Frontend

```bash
pnpm install
pnpm dev
```

Server-only environment variables (never `NEXT_PUBLIC_`):

```
WANDS_ENGINE_URL=https://engine.example.com
WANDS_ENGINE_TOKEN=<service token>
```

With neither set, the UI runs on fixtures tagged `provenance: "demo"` and says
so on every screen. That is intentional: an unconfigured engine must look
unconfigured, not empty.

## Backend

See [`backend/README.md`](backend/README.md) for setup and
[`backend/docs/`](backend/docs) for the audit, architecture, database schema,
API contracts, threat model, implementation plan and operations runbook.

```bash
cd backend
pip install -e ".[dev]"
pytest
```

## Safety posture

- Live trading is disabled by default and requires four independent conditions
  to enable, including an authenticated admin with MFA and an audit record.
- The risk engine is independent of strategy code and cannot be bypassed; the
  execution gateway is the only path to a broker.
- Strategies can only emit trade intents — enforced by an AST test, not a
  convention.
- Emergency stop and pause state live in the database and survive restarts.
- Capabilities that are not built return `501` rather than fabricated data.

No strategy is guaranteed to be profitable. The system is built to preserve
capital and to make its own limitations visible.
