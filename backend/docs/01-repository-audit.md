# Wands — Repository Audit

Audit performed against `ethersns/wands` at commit `27365e9` (branch `main`).

## 1. What exists today

The repository is a **Next.js 16 / React 19 frontend only**. There is no backend
service, no database, no broker integration and no trading logic in the tree.

| Area | Finding |
| --- | --- |
| Language | TypeScript (strict), Tailwind CSS v4, shadcn/Radix UI |
| Framework | Next.js 16.4.5 App Router, React 19.3.1 |
| Package manager | pnpm (`pnpm-lock.yaml`, `packageManager` field) |
| Runtime | Node (Vercel). No Python, no Docker, no database in the repo |
| Auth | None. No session, no user model, no protected route |
| Persistence | None. No ORM, no migrations, no database client |
| Tests | None. No test runner configured |
| CI | None |

### Routes present

```
app/page.tsx              dashboard
app/portfolio             portfolio
app/markets               markets
app/strategy-lab          strategies + backtests
app/bots                  trading bots
app/orders                orders + fills
app/risk                  risk policy + events
app/connections           broker/exchange connections
app/research              AI research surface
app/settings              user + engine settings
```

### API surface present

| Route | Purpose |
| --- | --- |
| `app/api/wands/[...path]/route.ts` | BFF proxy. Forwards `GET/POST/PATCH/DELETE` to `${WANDS_ENGINE_URL}/v1/<path>` with a server-side bearer token. Allow-lists the first path segment: `bots`, `risk`, `orders`, `connections`, `settings`, `backtests`, `engine`. Returns `503 not_configured` when the engine URL is unset. |
| `app/api/markets/candles/route.ts` | Local candle endpoint (UI-side). |
| `app/api/research/route.ts` | Local research endpoint (UI-side). |

### The existing engine contract (important)

`lib/api/contracts.ts` is the **de facto API specification** the frontend already
consumes. It defines:

- `Envelope<T>` — every engine response must be
  `{ data, provenance, generatedAt, source, warnings }` where `provenance` is
  `"live" | "demo" | "unavailable"`.
- `TradingMode` — `"backtest" | "paper" | "live"`.
- `DataProvenance` — the UI renders this next to every figure so a demonstration
  value can never be mistaken for a real balance.
- Domain types: `EngineStatus`, `PortfolioSummary`, `Position`, `BrokerAccount`,
  `Quote`, `CandleSeries`, `Strategy`, `TradingBot`, `BacktestResult`, `Order`,
  `Fill`, `TradeIntent`, `RiskPolicy`, `RiskSnapshot`, `RiskEvent`,
  `Connection`, `UserSettings`.

`lib/api/endpoints.ts` reads these paths:

```
GET /v1/engine/status
GET /v1/portfolio
GET /v1/markets/overview
GET /v1/markets/{symbol}/candles?interval=
GET /v1/strategies
GET /v1/bots
GET /v1/bots/logs
GET /v1/backtests
GET /v1/orders
GET /v1/fills
GET /v1/risk
GET /v1/connections
GET /v1/settings
```

`lib/api/browser.ts` (`engineMutation`) issues mutations through the proxy:

```
POST   /v1/bots
POST   /v1/bots/{id}/...            (pause / resume / stop)
POST   /v1/backtests
PATCH  /v1/risk/policy
POST   /v1/risk/pause
POST   /v1/risk/emergency-stop
POST   /v1/connections
POST   /v1/connections/{id}/...     (test / sync / delete)
PATCH  /v1/settings
```

### Behavioural contract already implemented in the frontend

`lib/api/endpoints.ts` degrades gracefully: if the engine is unconfigured or
unreachable, it returns a **`provenance: "demo"`** envelope built from
`lib/api/demo.ts` plus a warning string. `lib/api/browser.ts` never reports a
mutation as successful unless the engine returned 2xx.

This is a good property and the backend must not undermine it: **the engine must
never return fabricated data tagged `live`.** Returning `501` for a capability
that is not built yet is correct — the UI then shows labelled demo data.

## 2. What is missing

Everything server-side:

- No Python service, no FastAPI, no Pydantic models.
- No PostgreSQL schema, no migrations.
- No authentication, authorisation, audit trail or secret management.
- No risk engine, no execution gateway, no broker adapters.
- No market data ingestion, no backtester, no strategy modules.
- No containerisation, no deployment or operations documentation.

## 3. Constraints discovered

1. **The frontend is the contract.** The backend must emit camelCase JSON
   matching `lib/api/contracts.ts` exactly, wrapped in `Envelope<T>`. Changing
   the frontend types is out of scope for this phase.
2. **The browser never holds engine credentials.** All calls go through the
   Next.js BFF proxy with a server-side bearer token. The engine therefore needs
   a service-token auth path in addition to per-user credentials.
3. **The proxy allow-lists path prefixes.** New top-level engine routes must be
   added to `ALLOWED_PREFIXES` in `app/api/wands/[...path]/route.ts` or they are
   unreachable from the UI.
4. **Vercel cannot host the trading engine.** The frontend deploys to Vercel;
   the continuously running engine must live on a private VPS. The two are
   connected only by `WANDS_ENGINE_URL` + `WANDS_ENGINE_TOKEN`.
5. **No framework rewrite is warranted.** The frontend is coherent and typed.
   The backend is additive.

## 4. Decision

Add a self-contained Python service under `backend/` in the same repository.
The Next.js app is left functionally unchanged apart from documentation and an
env template. No existing file is rewritten.
