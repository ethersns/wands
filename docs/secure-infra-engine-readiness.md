# Secure infrastructure and engine readiness

Status: prepared, not deployed. Nothing in this change set was applied to
production, no production secret was read or rotated, and no engine was started.

> **Current state lives in `docs/feature-inventory.md`.** This document is the
> record of one change set and is not updated as the code moves. Two of its
> findings have since been resolved:
>
> - Section 11 item 6 (debug logging in production paths) is fixed. The leftover
>   `[v0]` prefix on the failure logs in `lib/admin/`, `lib/member/`,
>   `lib/billing/` and `lib/analytics/` is now `[wands]`.
> - Section 11 item 3 says the UI runs on demonstration fixtures. That is true of
>   the **operator** terminal (`lib/api/endpoints.ts` -> `lib/api/demo.ts`). The
>   **member** research surface has no demo fallback: `lib/api/research.ts`
>   degrades to `provenance: "unavailable"` with an empty payload and a stated
>   reason.

## 1. Starting commit

| | |
| --- | --- |
| Base branch | `main` |
| Starting commit | `e2984159261b31c34d8c8659cf5e6516708b49e7` (`e298415`) |
| Work branch | `security/secure-infra-engine-readiness` |

The audit's findings were re-checked against this commit before anything was
changed. All of them reproduced.

## 2. Security fixes implemented

### 2.1 The operator gate now fails closed

The gate opened itself whenever `NODE_ENV !== "production"`. That conflated
"this is not a production build" with "this is not production data". A
development server pointed at the production database therefore served the
trading console, the admin control centre and every engine proxy route to
anyone who could reach it.

The bypass is now explicit and isolated, in `lib/auth/dev-bypass.ts`. It
activates only when all three conditions hold:

1. `WANDS_DEV_OPERATOR_BYPASS=1` — the operator asked for it.
2. `NODE_ENV !== "production"` — a production build never bypasses.
3. `WANDS_DATABASE_ENV` is `development` or `test` — the operator has declared
   the database non-production.

Condition 3 is the one that would have prevented the original exposure. A
process that cannot prove what it is connected to now assumes the worst case
instead of the best.

`middleware.ts` and `lib/admin/guard.ts` both read this one module, so the edge
gate and the server-side gate cannot drift apart.

### 2.2 In-route authorization

Middleware is a routing convenience: a rewrite, a matcher edit or a direct
server render can skip it. Every sensitive route now re-validates the operator
session itself.

| Route | Guard |
| --- | --- |
| `app/(app)/layout.tsx` | `requireOperator()` before the engine status and markets fetches |
| `app/(app)/portfolio/page.tsx` | `requireOperator("/portfolio")` |
| `app/(app)/markets/page.tsx` | `requireOperator("/markets")` |
| `app/(app)/bots/page.tsx` | `requireOperator("/bots")` |
| `app/(app)/orders/page.tsx` | `requireOperator("/orders")` |
| `app/(app)/intelligence/page.tsx` | `requireOperator("/intelligence")` |
| `app/(app)/strategy-lab/page.tsx` | `requireOperator("/strategy-lab")` |
| `app/(app)/research/page.tsx` | `requireOperator("/research")` |
| `app/(app)/risk/page.tsx` | `requireOperator("/risk")` |
| `app/(app)/connections/page.tsx` | `requireOperator("/connections")` |
| `app/(app)/settings/page.tsx` | `requireOperator("/settings")` |
| `app/api/wands/[...path]/route.ts` | `authorizeOperatorRequest()` before forwarding |
| `app/api/research/route.ts` | `authorizeOperatorRequest()` before parsing the body |
| `app/api/markets/candles/route.ts` | `authorizeOperatorRequest()` before the engine call |

The layout guard covers the shell and the two engine calls it makes on the
page's behalf. The per-page guards cover client-side navigation between
terminal pages, where a shared layout is not re-rendered.

The three proxy routes matter most: each holds the engine's admin token, so an
unauthenticated request to any of them is an unauthenticated admin request to
the engine. `/api/research` is included because the assistant is handed the
operator's portfolio, risk policy, bot configuration and backtests as context.

### 2.3 Admin schema reproducibility

`scripts/db-setup.mts` applied `0001_member_workspace.sql` and never
`0002_admin_control_centre.sql`, so a fresh environment came up without the
admin control centre's tables and the founder's dashboard failed on first load.

The script now applies an ordered list and records each file in a new
`wands_schema_migration` table with a SHA-256 checksum. A re-run is a no-op. A
file whose contents changed after it was applied is refused rather than
replayed over a schema that no longer matches it.

Both migrations are written with `if not exists`, so the first run against a
database that already has the objects records them without altering a table, an
index or a row. Existing admin data and indexes are preserved.

**The script could not be run at all.** It had no entry point, and once one was
added it failed immediately: `lib/auth/member.ts` reaches `server-only` through
`lib/member/login-events.ts`, and that package throws outside a Next.js server
component. The `server-only` package resolves to a no-op under the
`react-server` condition, so the script now runs as:

```
pnpm db:setup
```

which is `tsx --conditions=react-server scripts/db-setup.mts`. `tsx` is a new
devDependency; it is needed because the module graph uses `@/` path aliases that
plain Node cannot resolve. Verified by running it against an unreachable host:
it loads the whole graph and fails at the connection, which is the expected
outcome and touches no database.

### 2.4 Privacy disclosures

The policy now describes what the analytics actually does: page-view
measurement, referrer host and category, UTM attribution, the daily-rotating
visitor digest, the 400-day retention horizon, and the controls available. It
also states the limit plainly — because the digest rotates daily and no IP is
stored, an individual's page views cannot be singled out for export or erasure.

## 3. Files changed

New:

- `lib/auth/dev-bypass.ts`
- `tests/auth/dev-bypass.test.ts`
- `tests/auth/engine-proxy-guard.test.ts`
- `docs/secure-infra-engine-readiness.md`

Modified:

- `middleware.ts`
- `lib/admin/guard.ts`
- `app/(app)/layout.tsx`
- `app/(app)/{portfolio,markets,bots,orders,intelligence,strategy-lab,research,risk,connections,settings}/page.tsx`
- `app/api/wands/[...path]/route.ts`
- `app/api/research/route.ts`
- `app/api/markets/candles/route.ts`
- `scripts/db-setup.mts`
- `app/(marketing)/privacy/page.tsx`
- `.env.example`
- `package.json` (adds the `db:setup` script and the `tsx` devDependency)
- `tests/admin/guard.test.ts`
- `tests/auth/middleware.test.ts`

## 4. Tests executed

| Check | Result |
| --- | --- |
| `npx vitest run` | 337 passed, 23 files (was 316) |
| `npx tsc --noEmit` | clean |
| `npx eslint .` | clean |

New coverage:

- `tests/auth/dev-bypass.test.ts` — each of the three conditions in isolation,
  plus the production-build backstop and the non-`1` flag value.
- `tests/auth/engine-proxy-guard.test.ts` — direct, unauthenticated requests to
  all three proxy routes answer 401; an unconfigured gate answers 503; a valid
  session is forwarded; no denial leaks the password or the session secret.
- `tests/admin/guard.test.ts` — the old "stays open in development" case is
  replaced by five cases covering the fail-closed policy.
- `tests/auth/middleware.test.ts` — the two "stays open in development" cases
  are replaced, and the member-session case now runs with the bypass active so
  it proves a customer session cannot inherit it.

No live order, no real-money execution and no production database was touched
by any test.

## 5. Database isolation plan

Development currently shares the production Neon database. This is the
remaining critical exposure and it needs the founder's hands, because it
changes Vercel and Neon settings.

**A Neon branch is not automatically safe.** A branch is copy-on-write from its
parent, so a branch taken from production starts with production's data. Do not
point development at a fresh production branch and call it isolated.

### Option A — empty database (recommended)

1. In Neon, create a new project or database that is not branched from
   production.
2. Copy its connection string.
3. In Vercel → Project → Settings → Environment Variables, set `DATABASE_URL`
   for the **Development** environment only. Leave Production and Preview
   untouched.
4. Set `WANDS_DATABASE_ENV=development` for the Development environment only.
5. Run `pnpm db:setup` against it. It creates the Better Auth tables, the member
   workspace and the admin control centre, and records both migrations.
6. Verify isolation before using it — see below.

### Option B — branch, then purge

1. Create a Neon branch from production.
2. Immediately delete the copied personal data in the branch:
   `truncate "user", session, account, verification, member_profile,
   member_watchlist, member_watchlist_item, member_saved_item,
   member_notification_pref, member_notification, member_membership,
   member_login_event, site_page_view, admin_audit_log, waitlist_entry,
   contact_message cascade;`
   (Confirm the table list against `\dt` first; the point is that no customer
   row survives.)
3. Continue from step 3 of Option A.

### Verifying isolation

Do not assume. Run these against the development connection string and confirm
the answers:

```sql
select current_database(), inet_server_addr();
select count(*) from "user";
select count(*) from member_profile;
```

The database name must be the development one, and the member counts must be
zero (or only accounts you created yourself). If either check surprises you,
stop and fix the connection string before opening the app.

### Constraints observed

- No production credential was rotated, overwritten or revealed.
- No Vercel or Neon production setting was changed.
- No production customer data was copied anywhere.

## 6. Required environment variables (names only)

Frontend:

- `DATABASE_URL`
- `WANDS_DATABASE_ENV`
- `WANDS_OPERATOR_USERNAME`
- `WANDS_OPERATOR_PASSWORD`
- `WANDS_SESSION_SECRET`
- `WANDS_FOUNDER_USER_IDS`
- `WANDS_DEV_OPERATOR_BYPASS` (local only, never on a deployment)
- `WANDS_ENGINE_URL`
- `WANDS_ENGINE_TOKEN`

Engine:

- `WANDS_DATABASE_URL`
- `WANDS_ENVIRONMENT`
- `WANDS_ENGINE_TOKEN`
- `WANDS_ENCRYPTION_KEY`
- `WANDS_TRADING_MODE`
- `WANDS_LIVE_TRADING_ENABLED`
- `WANDS_ALLOWED_ORIGINS`
- `WANDS_ALPACA_DATA_KEY`, `WANDS_ALPACA_DATA_SECRET` (equities only)
- `WANDS_SEC_USER_AGENT` (required if SEC ingestion is enabled)
- `WANDS_MARKET_DATA_WORKER_ENABLED`
- `WANDS_INTELLIGENCE_JOBS_ENABLED`

## 7. Founder access

`lib/auth/founder.ts` reads `WANDS_FOUNDER_USER_IDS` as a comma-separated list
of Better Auth user ids. Values are trimmed and empty entries dropped. It fails
closed: absent, empty or whitespace-only grants nobody. There is no
"first account to register" path, and a paid plan or completed onboarding does
not imply the grant.

**Retrieving the id safely.** Run this in the Neon SQL editor, not in
application code and not in a log:

```sql
select id from "user" where email = '<founder email>';
```

Copy the value into the environment variable. Do not paste it into a chat, a
commit, a ticket or a log line.

**Where to configure it.** Vercel → Project → Settings → Environment Variables.
Set it for Production. Set it for Preview as well only if the Opportunity Desk
is to be operated from a preview deployment. It is server-only and must never
carry a `NEXT_PUBLIC_` prefix.

**Which deployments need it.** Any deployment where the desk must be operable.
Without it the desk returns `unconfigured` and grants nothing — which is the
correct behaviour, not a bug.

## 8. Engine deployment plan

The engine is a long-lived FastAPI process, not a serverless function: it runs
an in-process market-data worker and an in-process job scheduler, both started
in the lifespan handler.

### Runtime

- Python 3.12 or newer.
- Dependencies from `backend/pyproject.toml`: `fastapi`, `uvicorn[standard]`,
  `pydantic`, `pydantic-settings`, `sqlalchemy`, `alembic`, `psycopg[binary]`,
  `cryptography`, `defusedxml`, `httpx`, `redis`, and the OpenTelemetry
  packages.
- PostgreSQL is required. The lifespan refuses to start if
  `WANDS_ENVIRONMENT=production` and the database URL is SQLite.
- **Redis is not required.** `redis` is a declared dependency and
  `WANDS_REDIS_URL` is a declared setting, but no module reads it — a search
  for `redis` across `backend/wands/` matches `config.py` only. Treat it as
  dead weight to remove, not as infrastructure to provision.

### Service authentication

Every route authenticates a bearer token through `wands/security/auth.py`.
`WANDS_ENGINE_TOKEN` is mandatory: `require_engine_token()` refuses to run
without it, because an unauthenticated trading API is unsafe. Privileged
operations require the admin role, and a human principal with enrolled MFA must
also present `x-wands-mfa-code`. The service token is exempt from MFA because
there is no human to challenge. A research-scoped credential is refused on the
operator surfaces.

`WANDS_ENCRYPTION_KEY` is a Fernet key and is required before any broker
credential can be stored. Generate it with:

```
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### Health endpoints

- `GET /healthz` — liveness. Returns the version. Does not touch the database.
- `GET /readyz` — readiness. Runs `SELECT 1` and answers 503 if the database is
  unreachable.

Point the platform liveness probe at `/healthz` and the readiness probe at
`/readyz`.

### Market data

- Crypto: Kraken, public endpoints, no key. `WANDS_KRAKEN_BASE_URL`,
  `WANDS_KRAKEN_RATE_LIMIT_PER_SECOND`.
- Equities: Alpaca, needs `WANDS_ALPACA_DATA_KEY` and
  `WANDS_ALPACA_DATA_SECRET`. `WANDS_ALPACA_DATA_FEED` defaults to `iex`
  (single-venue, real-time). Set `WANDS_ALPACA_DATA_DELAYED=true` when the
  account is not entitled to real-time SIP, so the data is never labelled live.
- Research: SEC EDGAR. If `WANDS_INTELLIGENCE_INGEST_ENABLED=true`,
  `WANDS_SEC_USER_AGENT` must contain a real operator address — the settings
  validator refuses to start on the shipped placeholder.
- `WANDS_MARKET_DATA_ENABLED=false` constructs no provider at all.

### Background workers

- `MarketDataWorker` — in-process thread, enabled by default
  (`WANDS_MARKET_DATA_WORKER_ENABLED`), interval `WANDS_MARKET_REFRESH_SECONDS`.
- `JobScheduler` — intelligence jobs, off by default
  (`WANDS_INTELLIGENCE_JOBS_ENABLED`). On start it reclaims any job whose lease
  outlived its process, so an interrupted crawl is visible rather than silently
  skipped.

Both are skipped when `WANDS_ENVIRONMENT=test`. Because both live in the
process, run exactly one engine instance unless the job lease is revisited.

### Startup and shutdown

The lifespan handler configures logging and telemetry, refuses SQLite in
production, runs the idempotent bootstrap (engine state, risk policy, builtin
strategies, system user, FX snapshots — all upserts), starts the worker and
scheduler, and stops both on shutdown. Restarting never duplicates a strategy
or resets a risk policy.

### Safety posture for the first connection

Keep `WANDS_TRADING_MODE=paper` and `WANDS_LIVE_TRADING_ENABLED=false`. The
first milestone is a manual, provider-backed Opportunity Desk test — not live
execution.

## 9. Migration prerequisites

The chain is linear with a single head:

```
d4a7b2c9e815 → e5b9c3d1f726 → f1a2b3c4d5e6 → a7c4e2b91f38 → b8d3f5a1c927
```

Verified state of `neondb`: current `e5b9c3d1f726`, pending `f1a2b3c4d5e6`,
`a7c4e2b91f38` then `b8d3f5a1c927`. `wands_engine` is at `a7c4e2b91f38` and
holds no data. Confirm which database is the target before running anything —
see `docs/railway-deployment.md` §4.

All three pending revisions are purely additive — `create_table` and
`create_index` only, touching nothing that already exists. `f1a2b3c4d5e6` adds
the Performance Lab tables; `a7c4e2b91f38` adds the three Opportunity Desk
tables; `b8d3f5a1c927` adds the institutional holdings index. Each downgrade
drops only what its own revision created.

Alembic resolves its URL from `WANDS_DATABASE_URL` via
`get_settings().database_url`, overriding the placeholder in `alembic.ini`.

### Sequence

1. **Confirm the actual state.** Do not trust the reported revision.
   ```
   cd backend
   alembic current
   ```
   and cross-check `select * from alembic_version;`. If it is not
   `e5b9c3d1f726`, stop and re-plan.
2. **Back up.** Take a Neon branch or snapshot, or `pg_dump` the database.
   Record the restore point.
3. **Upgrade.**
   ```
   alembic upgrade head
   ```
4. **Verify.**
   ```
   alembic current          # expect b8d3f5a1c927
   curl -fsS $ENGINE_URL/readyz
   ```
5. **Smoke test** the Opportunity Desk read paths. Do not place an order.

### Rollback

```
alembic downgrade e5b9c3d1f726
```

This drops the Performance Lab and Opportunity Desk tables and everything in
them. It is safe with respect to pre-existing tables, and destructive with
respect to the new ones. Prefer restoring the snapshot from step 2 if the new
tables hold anything worth keeping.

**Not run.** No migration was applied to any database during this task.

## 10. Manual configuration checklist

- [ ] Create the development database (Option A or B above).
- [ ] Set `DATABASE_URL` for the Vercel **Development** environment only.
- [ ] Set `WANDS_DATABASE_ENV=development` for Development only.
- [ ] Set `WANDS_DATABASE_ENV=production` for Production.
- [ ] Run `pnpm db:setup` against the development database.
- [ ] Verify isolation with the three queries in section 5.
- [ ] Retrieve the founder's Better Auth user id and set
      `WANDS_FOUNDER_USER_IDS` for Production.
- [ ] Confirm `WANDS_OPERATOR_USERNAME`, `WANDS_OPERATOR_PASSWORD` and
      `WANDS_SESSION_SECRET` are set for Production.
- [ ] Confirm `WANDS_DEV_OPERATOR_BYPASS` is **unset** on every deployment.
- [ ] Provision the engine host with Python 3.12 and the project dependencies.
- [ ] Set `WANDS_ENGINE_TOKEN` and `WANDS_ENCRYPTION_KEY` on the engine host.
- [ ] Set `WANDS_ENGINE_URL` and `WANDS_ENGINE_TOKEN` on the frontend.
- [ ] Point probes at `/healthz` and `/readyz`.
- [ ] Take the database backup, then run `alembic upgrade head`.
- [ ] Keep `WANDS_TRADING_MODE=paper` and `WANDS_LIVE_TRADING_ENABLED=false`.

## 11. Remaining blockers and risks

1. **Development still shares the production database.** The code no longer
   opens the gate for it, which removes the unauthenticated path, but the
   isolation itself is a manual step (section 5). Until it is done, a
   development process still holds production credentials.
2. **`WANDS_FOUNDER_USER_IDS` is unset.** The Opportunity Desk is unusable
   until it is configured. This is fail-closed by design, not a defect.
3. **The engine is not deployed and no engine connection is configured.** The
   UI runs on demonstration fixtures, labelled `provenance: "demo"`.
4. **Two engine migrations are unapplied.** Section 9 has the sequence; it
   needs approval and a backup first.
5. **`redis` is a declared dependency that nothing uses.** Either remove it or
   document why it is there. Provisioning Redis today would be wasted effort.
6. **Debug logging in production paths.** `lib/analytics/track.ts` and
   `lib/member/login-events.ts` still contain `console.log("[v0] ...")`
   statements from an earlier session. They log internal failure reasons to the
   server log. Low risk, but they should be removed or routed through the
   structured logger.
7. **The privacy policy still needs counsel.** The controller identity,
   registered address, data protection contact and any required representative
   are marked "to be completed by counsel".
8. **No engine integration test was run.** The engine was not started, so
   research-service connectivity and startup configuration are verified by
   reading the code, not by execution.

## 12. Review

Branch `security/secure-infra-engine-readiness`, based on `e298415`. Not
merged, not deployed.
