# Wands — Production Readiness 1.0

Status of the milestone: **implemented and locally verified; not
production-verified.** No VPS was provisioned, no billable resource was created,
and no production service was deployed. Live trading remains disabled.

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
| `app/api/session/route.ts` | sign-in / sign-out |
| `middleware.ts` | gate on `/api/wands/*` |
| `app/login/page.tsx` | operator sign-in page |
| `tests/auth/session.test.ts` | 15 tests |
| `tests/auth/middleware.test.ts` | 6 tests |

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

## 4. Test and build results

| Check | Result |
| --- | --- |
| Backend suite (`pytest`) | **449 passed** |
| Frontend suite (`vitest`) | **72 passed** |
| TypeScript (`tsc --noEmit`) | clean |
| ESLint | clean |
| Alembic `upgrade → downgrade → upgrade` | passed (in suite) |

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

## 11. Feature status

| Area | Implemented | Locally tested | Deployment-ready | Production-verified |
| --- | --- | --- | --- | --- |
| RBAC denial auditing | Yes | Yes | Yes | No |
| Audit append-only trigger | Yes | Yes (Postgres) | Yes | No |
| Denial posture endpoint | Yes | Yes | Yes | No |
| SQLite production guard | Yes | Yes | Yes | No |
| SEC contact validation | Yes | Yes | Yes | No |
| Operator gate (BFF) | Yes | Yes | Yes | No |
| Compose hardening | Yes | YAML only | Reviewed | No |
| Migrations on Postgres | Yes | Yes | Yes | No |
| Backup / restore | Yes | Yes (Postgres) | Yes | No |
| Frontend ↔ engine over TLS | Designed | No | Needs host | No |
| Live trading | Disabled | Yes | Disabled | Disabled |

No claim of production readiness is made from fixture tests alone.
