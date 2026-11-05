# Wands — Threat Model

Scope: the private trading engine, its database, its broker credentials and the
frontend↔engine link. Method: STRIDE over the trust boundaries below.

## Trust boundaries

| # | Boundary | Crossing |
| --- | --- | --- |
| B1 | Browser → Next.js BFF | untrusted user input |
| B2 | Next.js BFF → engine | bearer service token over TLS |
| B3 | Engine → broker/exchange API | outbound, credentialed |
| B4 | Engine → PostgreSQL / Redis | private network |
| B5 | Operator → engine admin routes | bearer API key + MFA |
| B6 | AI research → engine | structured proposals only |

## Assets

1. Broker and exchange API credentials (the highest-value asset — a leaked
   trading key can liquidate the account).
2. The risk policy and the emergency-stop state (integrity of these is what
   stands between a bug and a loss).
3. Order history and audit trail (non-repudiation).
4. Account balances and positions (confidentiality).
5. The engine's ability to *not* trade (availability of the stop path).

## Threats and mitigations

### Spoofing

| Threat | Mitigation |
| --- | --- |
| Stolen service token used to drive the engine | Token is server-only, never in a `NEXT_PUBLIC_` var, never in the browser bundle. Rotatable without redeploying the frontend. Constant-time comparison. |
| Stolen API key | Keys are stored as SHA-256 hashes; the plaintext exists only at creation. `key_prefix` lookup + hash compare. Revocable per key. |
| Replay of an admin mutation | MFA code required on admin mutations; audit row records request id and IP. |

### Tampering

| Threat | Mitigation |
| --- | --- |
| A strategy or the AI assistant raises its own risk limits | Risk policy is only writable through `PUT/PATCH /v1/risk` by an `admin` principal. Strategies have no database import at all (enforced by AST test). |
| A strategy submits an order directly | Strategies can only return `TradeIntent` values. `wands/strategies/**` may not import `wands.brokers` or `wands.execution.gateway`; `tests/test_strategy_isolation.py` fails the build otherwise. |
| Duplicate order from a retry | `orders.client_order_id` is unique in the database; the gateway checks before contacting a broker and returns the existing order on replay. |
| Order state edited in the database | Order transitions are append-only in code; every transition writes an audit event. Database access is restricted to the engine's role. |

### Repudiation

| Threat | Mitigation |
| --- | --- |
| "I never enabled live trading" | `audit_events` records actor, actor type, action, target, outcome, request id, IP and timestamp for every privileged action. Append-only; no update/delete route exists. |

### Information disclosure

| Threat | Mitigation |
| --- | --- |
| Credentials in source or logs | Credentials are Fernet-encrypted at rest with a key from the environment. Logs redact `authorization`, `password`, `secret`, `token`, `api_key`. `Connection` responses expose only `keyHint` (last four characters). |
| Database exposed to the internet | Compose publishes no ports for PostgreSQL or Redis; they are reachable only on the internal Docker network. |
| Error messages leaking internals | Unhandled exceptions return `engine_error` with a request id; the traceback goes to logs only. |

### Denial of service

| Threat | Mitigation |
| --- | --- |
| Request flood starves the trading loop | The API and the trading workers are separate processes; the API is rate-limited per principal. |
| Broker rate limits tripped by retries | The gateway applies exponential backoff and never retries an unknown outcome without reconciliation first. |

### Elevation of privilege

| Threat | Mitigation |
| --- | --- |
| `viewer` escalates to `admin` | Role is read from the credential, never from the request body. `require_role` is a dependency on every mutating route. |
| Live trading enabled by a non-human path | Requires the deployment env flag **and** a database flag **and** an authenticated admin with MFA **and** an audit row. No test, demo or AI path can set it. |
| Container escape / over-broad container | Containers run as a non-root user, read-only root filesystem where practical, no Docker socket mount, no `--privileged`. |

## Specific abuse cases and their tests

| Abuse case | Test |
| --- | --- |
| Strategy imports the broker adapter | `test_strategy_isolation.py` |
| Strategy calls the gateway | `test_strategy_isolation.py` |
| Order submitted while emergency stop engaged | `test_risk_engine.py` |
| Order submitted with a stale quote | `test_risk_engine.py` |
| Duplicate `client_order_id` | `test_idempotency.py` |
| Live order while live is disabled | `test_mode_separation.py` |
| Paper connection reused for live | `test_mode_separation.py` |
| Emergency stop lost on restart | `test_emergency_stop.py` |
| Unauthenticated request | `test_auth.py` |
| `viewer` calling an admin route | `test_auth.py` |
| Admin mutation without MFA | `test_auth.py` |
| Credential plaintext in a response | `test_connections.py` |

## Residual risks (accepted, documented)

1. **A compromised engine host is game over.** Encryption at rest protects
   backups and database dumps, not a live process holding the key. Mitigation is
   host hardening, least-privilege broker keys (no withdrawal permission) and
   monitoring — not application code.
2. **Interactive Brokers Gateway requires periodic re-authentication.** The
   adapter must surface `degraded` rather than pretend to be connected. Not
   implemented in this phase.
3. **Market data licensing** may forbid certain redistribution; the feed adapter
   must check entitlements before serving candles to the UI.
4. **No strategy is guaranteed profitable.** The backtester is designed to
   reject weak results, not to produce good ones.
