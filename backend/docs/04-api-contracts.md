# Wands — API Contracts (v1)

Base path `/v1`. All responses are JSON. All successful responses are wrapped in
the `Envelope<T>` shape the frontend already consumes:

```json
{
  "data": { },
  "provenance": "live",
  "generatedAt": "2026-11-05T12:00:00Z",
  "source": "wands-engine",
  "warnings": []
}
```

`provenance` is `live` only when the engine produced the value from real state.
It is `unavailable` when the engine is healthy but cannot produce the value
(no broker connected, feed down). It is never `demo` — demonstration fixtures
live in the frontend and are labelled there.

Errors use a different shape, matching `lib/api/browser.ts`:

```json
{ "error": { "code": "risk_rejected", "message": "…", "details": [] } }
```

## Authentication

`Authorization: Bearer <token>` on every route except `/healthz` and `/readyz`.

Two credential types:

- **Service token** (`WANDS_ENGINE_TOKEN`) — used by the Next.js BFF. Role
  `admin`, all scopes. Never leaves the server.
- **API key** (`wands_<prefix>_<secret>`) — per-user, hashed at rest, carries a
  role and explicit scopes.

Roles: `viewer` (read) < `operator` (pause/resume, create bots, run backtests)
< `admin` (risk policy, connections, live trading, emergency stop).

MFA: principals with `mfa_enabled` must send `X-Wands-MFA-Code` on
`admin`-scoped mutations. The service token is exempt because it is a
server-to-server credential that never reaches a browser.

## Endpoints

### Engine

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/v1/engine/status` | viewer | `EngineStatus` |
| POST | `/v1/engine/pause` | operator | body `{ "paused": true }` |
| POST | `/v1/engine/emergency-stop` | admin | engages the persisted stop |
| POST | `/v1/engine/emergency-stop/clear` | admin | requires MFA |
| POST | `/v1/engine/live-trading` | admin | requires MFA + deployment flag |
| GET | `/v1/engine/audit` | admin | recent audit events |

### Portfolio

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/v1/portfolio` | viewer | `PortfolioSummary`; `unavailable` until a broker is connected |
| GET | `/v1/positions` | viewer | `Position[]`; each carries `source` and price freshness |
| GET | `/v1/paper/accounts` | viewer | `PaperAccount[]` |
| POST | `/v1/paper/accounts` | operator | body `{ connectionId, startingCash, currency }`; paper-only |
| GET | `/v1/paper/accounts/{connectionId}` | viewer | `PaperAccount` |
| POST | `/v1/paper/accounts/{connectionId}/reset` | operator | body `{ startingCash, currency }`; audited |
| GET | `/v1/accounts/{connectionId}/verification` | viewer | `PortfolioVerification`; cash-versus-ledger reconciliation |
| GET | `/v1/accounts/{connectionId}/ledger` | viewer | `LedgerEntry[]` |

`POST /v1/paper/accounts` and its `reset` sibling are the only mutations in this
group. Both refuse a non-paper connection, and neither can promote an account to
live. Every call writes an audit row.

### Markets

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/v1/markets/overview` | viewer | `MarketOverview`; `unavailable` when no provider is configured |
| GET | `/v1/markets/health` | viewer | `MarketDataHealth[]`; per-provider reachability and last success |
| POST | `/v1/markets/refresh` | operator | force one ingestion pass |
| GET | `/v1/markets/{symbol}/quote` | viewer | `Quote`; includes `bid`, `ask`, `spreadPct`, `quality`, `ageSeconds` |
| GET | `/v1/markets/{symbol}/candles` | viewer | `CandleSeries`; `?interval=1m\|5m\|15m\|1h\|4h\|1d&limit=` |

Every quote carries `quality` (`live`, `delayed`, `historical`, `simulated`,
`unavailable`) and `ageSeconds` measured from the **provider** timestamp. A
delayed feed is never labelled live. `executablePrice` is `null` unless a
two-sided quote exists and is inside the freshness policy — a candle close is
never substituted for an executable price.

### Strategies

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/v1/strategies` | viewer | `Strategy[]` from the registry |
| POST | `/v1/strategies` | admin | register a strategy definition |

### Bots

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/v1/bots` | viewer | `TradingBot[]` |
| GET | `/v1/bots/logs` | viewer | `BotLogEntry[]` |
| POST | `/v1/bots` | operator | create; `mode` may not be `live` unless live is enabled |
| POST | `/v1/bots/{id}/pause` | operator | |
| POST | `/v1/bots/{id}/resume` | operator | |
| POST | `/v1/bots/{id}/stop` | operator | |

### Backtests

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/v1/backtests` | viewer | `BacktestResult[]` |
| GET | `/v1/backtests/{id}` | viewer | |
| POST | `/v1/backtests` | operator | `501` until Phase 6 — never a fabricated result |

### Orders and fills

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/v1/orders` | viewer | `Order[]` |
| GET | `/v1/fills` | viewer | `Fill[]` |
| POST | `/v1/orders` | operator | submit a `TradeIntent` through the gateway |
| POST | `/v1/orders/{id}/cancel` | operator | |

### Risk

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/v1/risk` | viewer | `RiskSnapshot` |
| PUT | `/v1/risk` | admin | replace the active policy |
| PATCH | `/v1/risk/policy` | admin | partial update |
| POST | `/v1/risk/pause` | operator | body `{ "paused": true }` |
| POST | `/v1/risk/emergency-stop` | admin | alias of the engine stop |

### Connections

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/v1/connections` | viewer | `Connection[]`; credentials never returned |
| POST | `/v1/connections` | admin | credentials encrypted at rest |
| POST | `/v1/connections/{id}/test` | admin | adapter availability check |
| DELETE | `/v1/connections/{id}` | admin | |

### Settings

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/v1/settings` | viewer | `UserSettings` |
| PATCH | `/v1/settings` | viewer | own settings only |

### Operations

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/healthz` | none | liveness |
| GET | `/readyz` | none | database reachable |
| GET | `/openapi.json` | none | OpenAPI 3.1 |

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `unauthorized` | 401 | missing/invalid credential |
| `forbidden` | 403 | role or scope insufficient, or MFA required |
| `not_found` | 404 | unknown resource |
| `bad_request` | 422 | validation failure |
| `conflict` | 409 | duplicate client order id, optimistic-lock conflict |
| `risk_rejected` | 422 | the risk engine blocked the order; `details` lists violations |
| `live_trading_disabled` | 403 | live mode requested while disabled |
| `not_implemented` | 501 | capability not built yet — never substituted with fake data |
| `engine_error` | 500 | unexpected failure |

## TypeScript generation

`GET /openapi.json` is the source of truth. It is a standard OpenAPI 3.1
document, so the frontend can generate types from it with
`npx openapi-typescript http://<engine>/openapi.json -o lib/api/engine.d.ts`
rather than maintaining a second hand-written copy of the contract. The
hand-written `lib/api/contracts.ts` remains the contract the UI is built
against; the generated file is the check that the engine still matches it.
