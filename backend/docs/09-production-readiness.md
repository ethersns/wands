# Wands — Production Readiness 1.0

Status of the milestone: **implemented and locally verified; not
production-verified.** No VPS was provisioned, no billable resource was created,
and no production service was deployed. Live trading remains disabled.

This revision continues the paused plan. Tasks 1–5 were already complete; this
pass finished **task 6 (SEC ingestion operational hardening)** and **task 7
(observability, DR drills, deployment guide)**, and added the cross-agent
compatibility check against the commercial site. Sections 3a and 11 are new.

## 1. Repository and merge state

| Item | Value |
| --- | --- |
| Base branch | `main` |
| Base HEAD | `5676bb34c9d250d4fbb5cfe74e3936c1955156d3` |
| Work branch | `v0/production-readiness-1-0` |
| Work commit | `8b99bd6` |
| `f70d9cc` in `main` | Yes (ancestor of HEAD) |
| `bc77eac` in `main` | Yes (ancestor of HEAD) |

Both recent fixes are present on the default branch. `bc77eac` arrived via
merge commit `5676bb3` (PR #7); `f70d9cc` via `0498856` (PR #6). There were no
unmerged changes on `main` when this work started.

Verified on the current HEAD:

- SEC raw XML path resolution — `_XSL_VIEW_PREFIX` strips the `xslF345X06/`
  view prefix in `wands/intelligence/edgar.py`.
- Correct filing dates — `filed_date=ref.filed_date` is used for the filing
  date rather than the parsed document date.
- Intelligence API, four Alembic migrations, risk engine and execution gateway
  are all present and covered by the suite.
- Frontend API contracts and the BFF proxy are present.

## 2. Files modified

Backend:

| File | Change |
| --- | --- |
| `wands/security/audit.py` | `record_denial`, denial counters, dedupe |
| `wands/api/deps.py` | stash the principal on `request.state` |
| `wands/main.py` | `Forbidden`/`Unauthorized` handlers, SQLite production guard |
| `wands/api/routes/engine.py` | `GET /v1/engine/security` posture endpoint |
| `wands/config.py` | SEC contact validation |
| `alembic/versions/d4a7b2c9e815_audit_append_only.py` | append-only trigger |
| `scripts/verify_deployment.py` | host verification tool |
| `tests/test_audit_denials.py` | 9 denial tests |
| `tests/test_deployment_guards.py` | 6 guard tests |
| `Dockerfile` | pinned base, loopback-only forwarded IPs, no auto-migrate |
| `docker-compose.yml` | migrate service, limits, log rotation, no Redis |
| `.env.example` | Redis correction, proxy trust, SEC section |
| `docs/07-operations.md` | rewritten runbook |

Frontend:

| File | Change |
| --- | --- |
| `lib/auth/session.ts` | signed operator session (Web Crypto) |
| `lib/auth/routes.ts` | **new** — three-tier route classification |
| `app/api/session/route.ts` | sign-in / sign-out |
| `middleware.ts` | gate on the operator tier, not just `/api/wands/*` |
| `app/login/page.tsx` | operator sign-in page; honours `next` with an open-redirect guard |
| `tests/auth/session.test.ts` | 15 tests |
| `tests/auth/middleware.test.ts` | 17 tests |

Backend, this pass:

| File | Change |
| --- | --- |
| `wands/intelligence/ingest.py` | `ingest_disabled_reason()`, rate limit and retries wired in `build_client()` |
| `wands/intelligence/backfill.py` | enforces the ingest switch |
| `tests/conftest.py` | enables ingestion with a real contact for the suite |
| `tests/test_intelligence_ingest.py` | 3 tests for the switch and the client wiring |
| `tests/test_deployment_guards.py` | pinned so the suite switch cannot leak in |
| `docs/07-operations.md` | SEC section corrected and extended |

## 3. Security issues fixed

**1. RBAC denials were never audited (the reported gap).** Authorisation is a
FastAPI dependency, so a 403 is raised before the route body runs. Auditing
inside handlers therefore never saw a denial. Denials are now recorded by a
dedicated exception handler that commits in its own transaction — the request
session is rolled back when the 403 propagates, so a denial written there would
have vanished with the request that produced it.

Each row records actor, actor type, action (`authorization.denied`), target
(`METHOD /path`), timestamp, outcome (`denied`), request correlation id, client
IP, and the role that was refused. Duplicates are suppressed by request id.
Credentials are never recorded: the detail carries only the error code, the
refusal reason and the role, and `redact()` runs over it regardless.

**2. Unauthenticated rejections could flood the audit table.** A 401 has no
principal and the caller controls the retry rate. These are counted in memory
and logged as `event=auth.rejected` instead of being persisted. The decision is
documented in `audit.py` and surfaced on `GET /v1/engine/security`.

**3. The audit trail was only append-only in application code.** A Postgres
trigger now rejects `UPDATE` and `DELETE` on `audit_events`, so a database
connection cannot rewrite history. Verified: both statements raise.

**4. The BFF was an unauthenticated admin proxy.** `/api/wands/*` forwards to
the engine with a server-side admin token, and the Next.js app had no auth at
all — anyone who could load the site could pause trading or change the risk
policy. A signed, HttpOnly operator session is now required. When the gate is
unconfigured it fails closed (503) in production rather than silently becoming
public.

**5. Audit client IPs were forgeable.** The image ran uvicorn with
`--forwarded-allow-ips='*'`, and the engine records the client IP from
`X-Forwarded-For`. Any caller could forge the address in the trail. It now
defaults to loopback and is configurable per host.

**6. A misconfigured host could serve an empty database.** Nothing stopped
production from starting on SQLite, which would create a fresh empty database
and serve it as real state. The engine now refuses to start.

**7. SEC collection could run with a placeholder contact.** The shipped user
agent carries `ops@example.com`. Enabling ingestion now fails validation until a
real address is configured. No contact was fabricated.

## 3a. Issues found in this pass

**8. Two more unauthenticated admin proxies.** The previous pass gated
`/api/wands/*` and stopped there. `POST /api/research` and
`GET /api/markets/candles` also call the engine through `engineFetch()`, which
attaches the server-side `WANDS_ENGINE_TOKEN`. Neither was behind the operator
gate, so anyone who could load the site could:

- make the engine fetch the operator's real portfolio, risk policy, bot list and
  backtests, and feed them to a language model (`/api/research`), and
- read the engine's candle feed (`/api/markets/candles`).

This is the same defect class as issue 4, in routes the first fix did not cover.
Both are now in the operator tier. Verified against a production build: 401
without a session, 200 with one.

**9. The SEC ingestion switch was not enforced.** `WANDS_INTELLIGENCE_INGEST_ENABLED`
was documented as the master switch and checked only by the startup validator.
The collectors themselves checked `intelligence_enabled`, which defaults to
**true**. A host that set nothing would therefore have collected from the SEC
with the placeholder contact. `ingest_disabled_reason()` is now called by all
three collectors — insider, institutional and backfill — so the scheduler, the
CLI and the API backfill all refuse.

**10. The SEC rate limit and retry budget were dead configuration.**
`WANDS_SEC_RATE_LIMIT_PER_SECOND` and `WANDS_SEC_MAX_RETRIES` were defined and
documented as respected, but `build_client()` never passed them and
`EdgarClient` hardcoded `TokenBucket(5.0, 5)`. The published fair-access ceiling
was a constant in the transport, not a deployment setting. Both are now wired
through `build_client()`.

## 4. Test and build results

| Check | Result |
| --- | --- |
| Backend suite (`pytest`) | **452 passed** |
| Frontend suite (`vitest`) | **83 passed** |
| TypeScript (`tsc --noEmit`) | clean |
| ESLint | clean |
| Next.js production build | passed (24 routes) |
| Alembic `upgrade → downgrade → upgrade` | passed (in suite) |
| Production gate, live server | passed (see section 12) |

New coverage: 9 denial tests (viewer, operator, admin-without-MFA, admin-with-
MFA, single-event, unauthenticated, no-credential-in-detail, audit-store-down,
deployment-level refusal), 6 deployment guards, 21 frontend session/middleware
tests.

## 5. PostgreSQL verification

Run against a real **PostgreSQL 15.19** instance, not SQLite.

| Check | Result |
| --- | --- |
| `alembic upgrade head` (5 migrations) | passed |
| Append-only trigger blocks `UPDATE` | passed |
| Append-only trigger blocks `DELETE` | passed |
| `alembic downgrade -1` then `upgrade head` | passed, data intact |
| `pg_dump -Fc` + `pg_restore` into a separate database | passed: rows, revision and trigger restored |
| `scripts/verify_deployment --probe` | **8/8 checks passed** |
| End-to-end denial audit on Postgres | passed (`outcome=denied`, request id recorded) |
| PostgreSQL unreachable | `/readyz` 503; protected route 500; never 200 |

The probe creates a throwaway viewer credential, provokes a 403, confirms the
row landed in `audit_events`, then removes the credential. The audit row is
left behind on purpose.

## 6. Docker verification

**Not verified.** Docker is not available in the build environment, so
`docker compose up`, the `migrate` service ordering, healthchecks, resource
limits and the backup service were **not executed**. The compose file was
validated by YAML parse and review only.

This is the largest remaining gap. Treat the container configuration as
reviewed-but-unrun until it has been started on a real host.

Redis: not applicable. No module imports a Redis client, so the service was
removed rather than left running idle.

## 7. Remaining deployment blockers

1. **Docker stack has never been started.** Run `docker compose up -d --build`
   on the target host and confirm the `migrate` service completes before the
   engine starts.
2. **No TLS reverse proxy is configured.** The engine binds loopback only; a
   Caddy/nginx front end with a real certificate is required before the Vercel
   frontend can reach it.
3. **The operator gate must be configured on Vercel.** Without
   `WANDS_OPERATOR_PASSWORD` and `WANDS_SESSION_SECRET`, production returns 503
   for every engine action by design.
4. **Frontend-to-engine connectivity has not been tested from the Vercel
   runtime.** It was verified locally only.
5. **No off-host backup destination is configured.** The backup service writes
   to `./backups`; shipping those off-host is an operator step.
6. **No monitoring backend is wired.** The signals and thresholds are documented
   in `07-operations.md`; nothing is scraping them yet.
7. **Engine token rotation and container restart drills were not run** (no host).
8. **Dependency versions are lower-bounded, not locked.** `pyproject.toml` uses
   `>=` with no lockfile, so two builds can resolve differently. Pin before
   relying on reproducible rebuilds.
9. **The console and the marketing site still share a root layout and a home
   route.** `/` is the trading dashboard and `app/layout.tsx` wraps every route
   in the console shell with a global `noindex`. The commercial site cannot ship
   a public landing page until the console moves to `/dashboard` and the shell
   moves into a console-only route group. Details in section 11.

## 8. Required environment variables

Host (`.env`, `chmod 600`):

| Variable | Required | Notes |
| --- | --- | --- |
| `WANDS_ENVIRONMENT` | yes | `production` |
| `WANDS_DATABASE_URL` | yes | set by compose from `POSTGRES_*` |
| `POSTGRES_PASSWORD` | yes | compose refuses to start without it |
| `WANDS_ENGINE_TOKEN` | yes | 48+ random bytes |
| `WANDS_ENCRYPTION_KEY` | yes | Fernet key; rotation needs re-encryption |
| `WANDS_API_KEY_PEPPER` | yes | mixed into API key hashes |
| `WANDS_ALLOWED_ORIGINS` | yes | the Vercel origin |
| `WANDS_FORWARDED_ALLOW_IPS` | recommended | reverse proxy address |
| `WANDS_LIVE_TRADING_ENABLED` | yes | `false` |
| `WANDS_SEC_USER_AGENT` | before ingestion | must carry a real contact |
| `WANDS_INTELLIGENCE_INGEST_ENABLED` | yes | `false` until ready |
| `WANDS_INTELLIGENCE_JOBS_ENABLED` | yes | `false` until ready |
| `WANDS_INTELLIGENCE_BACKFILL_ENABLED` | yes | `false` until ready |

Vercel (server-only, never `NEXT_PUBLIC_`):

| Variable | Required |
| --- | --- |
| `WANDS_ENGINE_URL` | yes |
| `WANDS_ENGINE_TOKEN` | yes |
| `WANDS_OPERATOR_PASSWORD` | yes |
| `WANDS_SESSION_SECRET` | yes |

## 9. Estimated recurring cost

| Item | Monthly |
| --- | --- |
| VPS, 2 vCPU / 4 GB | ~$10–25 |
| Off-host backup storage, 50 GB | ~$1–5 |
| Vercel Pro (only if needed) | $20 |
| **Total excluding Vercel** | **~$11–30** |

Indicative only; confirm current pricing before committing.

## 10. Next operator actions

1. Provision a 2 vCPU / 4 GB Ubuntu 24.04 VPS. Harden SSH, enable `ufw` with
   only 22 and 443 open.
2. Install Docker Engine and the compose plugin; clone the repo; check out
   `v0/production-readiness-1-0`.
3. Generate the secrets listed in section 8 and write `.env` with `chmod 600`.
4. `docker compose up -d --build`. Confirm `migrate` exits 0 before the engine
   starts.
5. `docker compose exec engine python -m scripts.verify_deployment --probe`.
   All checks must pass.
6. Put Caddy in front of `127.0.0.1:8000` with a real certificate. Confirm
   `https://engine.<domain>/healthz` from outside the host.
7. Set the four Vercel variables. Sign in at `/login` and confirm
   `/api/wands/engine/status` returns 200 from the deployed frontend.
8. Schedule the nightly backup from cron and copy dumps off-host. Run one
   restore drill into a scratch database.
9. Wire the alerts in `07-operations.md` section 9.
10. Only then consider enabling SEC collection, starting with a narrow date
    range and a short issuer list.

## 11. Commercial site compatibility

A second agent is building the public landing page, pricing, Stripe and waitlist.
The gate now classifies every path into one of three tiers in
`lib/auth/routes.ts`, and the classification is the single place to change:

| Tier | Paths | Requirement |
| --- | --- | --- |
| `public` | everything not listed below, including `/`, `/login`, `/pricing`, `/waitlist`, `/legal/*`, `/blog/*` | none |
| `customer` | reserved, currently empty | a customer session, never an operator one |
| `operator` | `/api/wands/*`, `/api/research`, `/api/markets/*`, `/dashboard`, `/portfolio`, `/markets`, `/bots`, `/orders`, `/intelligence`, `/strategy-lab`, `/research`, `/risk`, `/connections`, `/settings` | signed operator session |

Unknown paths are **public**. That is deliberate: the commercial site adds pages
without editing this file, and a new public page must never be blocked by a gate
that has not heard of it. The cost is that a new *private* page is public until
it is listed, so the operator list is the thing to keep current. A test asserts
the middleware matcher covers every operator prefix.

Verified against a production build with the gate configured:

| Request | No session | With session |
| --- | --- | --- |
| `GET /login` | 200 | 200 |
| `GET /portfolio` | 307 → `/login?next=/portfolio` | 200 |
| `GET /risk` | 307 → `/login` | 200 |
| `GET /api/research` | 401 | 405 (reaches the POST-only handler) |
| `GET /api/markets/candles` | 401 | 200 |
| `GET /api/wands/engine/status` | 401 | proxied |
| forged `wands_operator` cookie | 401 | — |
| wrong password at `POST /api/session` | 401 | — |

The remaining cross-agent properties hold by construction:

- **No marketing form can reach the engine.** The only routes that call
  `engineFetch()` are the three operator-tier API paths. A waitlist or checkout
  route added by the commercial site does not import it.
- **Stripe webhooks cannot impersonate an operator.** The session is a signed
  HttpOnly cookie; a webhook route receives no cookie and cannot mint one
  without `WANDS_SESSION_SECRET`.
- **Billing credentials cannot reach trading services.** `WANDS_ENGINE_TOKEN` is
  server-only and read by `engineConfig()`. Stripe keys are separate variables
  and nothing forwards one as the other.
- **The frontend cannot be tricked into forwarding an admin request.** The BFF
  builds the upstream request from scratch — method, body and a fixed
  `authorization` header. It never spreads `request.headers`, so a client cannot
  inject or override the engine credential.
- **Protection is server-side.** The gate is middleware plus engine RBAC. Hiding
  a control in the UI is never the enforcement.

### Shared-file conflicts to resolve at integration

1. **`app/page.tsx` is the trading dashboard, and `/` is classified public.**
   The commercial site will want `/` for the landing page. The console should
   move to `/dashboard`, which is already in the operator tier, so the move needs
   no gate change. Until it moves, the dashboard's HTML shell is public — its
   data is not, because every call it makes is gated.
2. **`app/layout.tsx` wraps every route in `AppShell`** (sidebar, market tape,
   emergency stop) and sets `robots: { index: false }` globally. A public
   marketing page rendered inside that shell is wrong, and a global `noindex`
   deindexes the marketing site. The shell and the metadata need to move to a
   route group that only the console uses.
3. **`middleware.ts` and `lib/auth/routes.ts`** are shared. The commercial site
   should add its billing paths to `CUSTOMER_PREFIXES` rather than editing the
   matcher.
4. **`components/shell/nav-items.ts`** lists `/` as the Dashboard. It needs the
   same move as item 1.

## 12. Feature status

| Area | Implemented | Locally tested | Deployment-ready | Production-verified |
| --- | --- | --- | --- | --- |
| RBAC denial auditing | Yes | Yes | Yes | No |
| Audit append-only trigger | Yes | Yes (Postgres) | Yes | No |
| Denial posture endpoint | Yes | Yes | Yes | No |
| SQLite production guard | Yes | Yes | Yes | No |
| SEC contact validation | Yes | Yes | Yes | No |
| Operator gate (BFF) | Yes | Yes | Yes | No |
| Route tier classification | Yes | Yes | Yes | No |
| Research/candles gate | Yes | Yes | Yes | No |
| SEC ingest switch enforced | Yes | Yes | Yes | No |
| SEC rate limit from settings | Yes | Yes | Yes | No |
| Compose hardening | Yes | YAML only | Reviewed | No |
| Migrations on Postgres | Yes | Yes | Yes | No |
| Backup / restore | Yes | Yes (Postgres) | Yes | No |
| Frontend ↔ engine over TLS | Designed | No | Needs host | No |
| Live trading | Disabled | Yes | Disabled | Disabled |

No claim of production readiness is made from fixture tests alone.
