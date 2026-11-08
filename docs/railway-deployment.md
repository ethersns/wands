# Railway deployment runbook

Deploying the existing Python engine to Railway, with the Next.js frontend
staying on Vercel. This document records what was verified by execution and what
was not.

**Status: prepared, not deployed.** No Railway account, CLI or token was
available in the environment where this was prepared, so no Railway build or
deploy was attempted. Everything below the "Owner actions" heading is the
remaining work.

---

## 1. What this deploys

One long-lived FastAPI process (`backend/`) that serves the research API and,
when enabled, runs an in-process market-data worker and job scheduler. It is not
a serverless function and cannot be split across replicas: the scheduler and
worker start in the application lifespan, so a second replica would run a second
scheduler against the same tables.

The frontend stays on Vercel and reaches the engine over HTTPS with a bearer
token.

---

## 2. Owner actions

These are the only steps that need a human with Railway access.

1. Create a Railway project and add an **empty service** from the
   `ethersns/wands` GitHub repo.
2. Set the service **Root Directory** to `backend`. `backend/railway.json` is
   then picked up automatically and points at `backend/Dockerfile`.
3. Confirm the plan is the **Free** plan. Do not add a Railway Postgres — see
   section 4 for why.
4. Add the variables from `backend/.env.railway.example`. Generate the secrets
   locally; do not paste them into a chat or a commit.
5. Deploy. Railway builds the Dockerfile and probes `/healthz`.
6. Run the migration step in section 5 **before** pointing the frontend at the
   service.
7. Run the verification in section 6 and paste the output back.

---

## 3. Configuration actually used

`backend/railway.json`:

| Setting | Value | Why |
| --- | --- | --- |
| builder | `DOCKERFILE` | Reuses the existing image; no rebuild of the backend |
| dockerfilePath | `Dockerfile` | Relative to the `backend` root directory |
| healthcheckPath | `/healthz` | Returns 200 without touching the database |
| healthcheckTimeout | 120 | Cold start installs nothing at runtime, but the first boot runs `bootstrap` |
| restartPolicyType | `ON_FAILURE` | A crash loop should not be masked by always-restart |
| restartPolicyMaxRetries | 3 | Stops a bad deploy from burning the free allowance |
| numReplicas | 1 | **Required.** A second replica runs a second scheduler |
| sleepApplication | false | A sleeping service stops the scheduler and drops the first request |

The Dockerfile was changed in one respect: the start command now honours
`PORT` (`--port ${PORT:-8000}`), because Railway injects `PORT` and routes only
to the port it assigned. `8000` remains the default, so `docker-compose.yml` is
unaffected.

`WANDS_FORWARDED_ALLOW_IPS` is deliberately left unset. Setting it to `*` would
let any caller forge the client address recorded in the audit trail. Unset means
the audit trail records Railway's proxy address rather than the true client —
less precise, but wrong in the safe direction.

---

## 4. Database

**Do not add a Railway Postgres.** It draws on the same free allowance as the
service and the brief forbids new chargeable resources.

**Do not point the engine at the application database.** The Next.js app uses
`neondb` on the existing Neon project. Running engine migrations there would mix
two schemas in one database and make a rollback of either one unsafe.

**What was done instead:** a separate database, `wands_engine`, was created on
the same Neon project. Same server, same credentials, no new service, and the
engine's 45 tables are physically separate from the application's.

Set `WANDS_DATABASE_URL` to that database. The scheme must be
`postgresql+psycopg://` for the psycopg 3 driver. Use the direct (non-pooler)
host for migrations and the pooled host for the running service if you prefer.

### Schema compatibility: verified

The full migration chain was applied to `wands_engine` on PostgreSQL 18.6:

```
30aab3f55099  initial schema
7c1d4a9e2b30  phase 3: market data, portfolio accounting and paper accounts
9b4e2c7d1a05  intelligence v1: SEC ownership filings, 13F holdings and research signals
c3f8a1d6e204  intelligence v1.1: backfill cursors, identifier history, jobs, experiments
d4a7b2c9e815  audit integrity: make audit_events append-only in the database
e5b9c3d1f726  price history adjustment and coverage
f1a2b3c4d5e6  performance lab evidence capture
a7c4e2b91f38  opportunity desk research records
```

Result: 45 tables, `alembic_version` at `a7c4e2b91f38`, and the
`audit_events_append_only` trigger present. The chain has a single head, so
there is no branch to reconcile.

---

## 5. Migration process

Migrations are **not** run on container start. The Dockerfile deliberately
leaves them out so a restart can never apply a schema change nobody asked for.

Run them as an explicit step, from a machine that can reach the database:

```bash
cd backend
export WANDS_DATABASE_URL='postgresql+psycopg://...'   # wands_engine, direct host

# 1. Back up first. Neon: create a branch or a restore point in the console.
#    A branch is instant and costs nothing on the free plan.

# 2. See what would run.
python -m alembic current
python -m alembic history --verbose | head -40

# 3. Apply.
python -m alembic upgrade head

# 4. Confirm.
python -m alembic current
```

If a migration fails, do not re-run it blindly. Restore the Neon branch, read
the failing revision, and fix forward in a new revision.

---

## 6. Verification

### Verified by execution (local, against `wands_engine`)

The engine was started with `WANDS_ENVIRONMENT=production`, the market-data
worker and job scheduler off, and a pool size of 2.

| Check | Result |
| --- | --- |
| `GET /healthz` | 200, `provenance: live` |
| `GET /readyz` | 200, database reachable |
| `GET /v1/intelligence/dashboard` with a research key | 200, `freshness: never`, all counts 0 |
| `GET /v1/intelligence/institutions` with a research key | 200, empty, `provenance: unavailable`, warning "No 13F filings are stored" |
| `GET /v1/intelligence/signals` with a research key | 200, empty, `provenance: unavailable` |
| `GET /v1/intelligence/dashboard` with no token | 401 |
| `GET /v1/engine/status` with a research key | 403, "scoped to research and cannot reach this surface" |
| `GET /v1/engine/audit` with a research key | 403, same |
| `python -m scripts.verify_deployment` | 7 of 7 checks passed |

The empty research responses are the correct result, not a failure: nothing has
been ingested, and the engine says so rather than inventing data.

### Not verified

- The Railway build and deploy itself. No access.
- Behaviour under 0.5 GB RAM. The process was not measured under that ceiling.
- The job scheduler and market-data worker, which were off.
- SEC ingestion, which was off.
- Any request over the public internet, TLS, or Railway's proxy.

Do not treat a green Railway build as evidence that the API or scheduler works.
The checks in the table above are the evidence; re-run them against the deployed
URL.

### After deploying

```bash
BASE=https://<service>.up.railway.app
curl -s -o /dev/null -w '%{http_code}\n' $BASE/healthz     # expect 200
curl -s -o /dev/null -w '%{http_code}\n' $BASE/readyz      # expect 200
curl -s -o /dev/null -w '%{http_code}\n' $BASE/v1/intelligence/dashboard  # expect 401
```

Then run `python -m scripts.verify_deployment` against the deployed database.

---

## 7. Connecting Vercel

Two variables on the Vercel project, both server-only:

| Variable | Value |
| --- | --- |
| `WANDS_ENGINE_URL` | The Railway public URL, no trailing slash |
| `WANDS_RESEARCH_TOKEN` | A research-scoped API key, `wands_<prefix>_<secret>` |

Mint the key on the deployed engine:

```bash
cd backend
python -m scripts.create_research_key --email research@yourdomain.com
```

It prints the key once and stores only its SHA-256 hash. The key carries
`research:read` and nothing else, so `deny_research_only` keeps it off every
operator surface — verified above with the 403s.

`lib/api/research.ts` reads `WANDS_RESEARCH_TOKEN` and has no fallback to the
operator token. If it is unset, member research renders `unavailable` rather
than borrowing a wider credential.

Do not set `WANDS_ENGINE_TOKEN` on Vercel for the member surface. That is the
service token with every scope, and it belongs to the operator console only.

---

## 8. Kraken read-only credentials

Do not store broker credentials until `WANDS_ENCRYPTION_KEY` is set on the
engine. `settings.require_encryption_key()` raises rather than falling back to
an unencrypted store, so the failure is loud — but the check is only reached
when a credential is written, not at startup.

Order of operations:

1. Set `WANDS_ENCRYPTION_KEY` (a Fernet key) on Railway.
2. Restart and confirm `/readyz` is 200.
3. Only then add a Kraken **read-only** key through the operator console.
4. Confirm the stored value is ciphertext, not plaintext.

Live trading stays off: `WANDS_LIVE_TRADING_ENABLED=false`, and
`verify_deployment.py` fails the host if the database disagrees.

---

## 9. Resource expectations on the free plan

1 vCPU and 0.5 GB RAM after the trial. The defaults are too wide for that:

| Variable | Value | Reason |
| --- | --- | --- |
| `WANDS_DATABASE_POOL_SIZE` | `2` | Default 5 holds five idle connections |
| `WANDS_MARKET_DATA_WORKER_ENABLED` | `false` | A polling loop plus candle buffers is the largest avoidable allocation |
| `WANDS_INTELLIGENCE_JOBS_ENABLED` | `false` | Off until ingestion is authorised |
| `WANDS_INTELLIGENCE_INGEST_ENABLED` | `false` | Off until a real SEC contact is set |

Turn the worker on only after watching memory on the deployed service. If the
service is OOM-killed, the worker is the first thing to leave off.

---

## 10. Rollback

- **Bad deploy:** Railway keeps previous deployments; redeploy the last good one.
- **Bad migration:** restore the Neon branch taken in section 5. Do not
  `downgrade` a migration that dropped a column — the data is gone either way.
- **Frontend:** unset `WANDS_ENGINE_URL`. Member research returns to the
  `unavailable` state, which is the designed degradation, not an outage.
