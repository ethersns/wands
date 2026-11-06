# Wands — Deployment and Operations

This is the runbook for running the engine continuously on a private Linux VPS
with a hosted Next.js frontend. It describes what is implemented, what was
verified locally, and what still needs a real host to confirm.

## 1. Host requirements and cost

| Resource | Minimum | Comfortable |
| --- | --- | --- |
| vCPU | 2 | 4 |
| RAM | 4 GB | 8 GB |
| Disk | 40 GB SSD | 80 GB SSD |
| OS | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |

The engine is a single process. PostgreSQL runs beside it in Docker. There is
**no Redis**: the engine declares a `redis_url` setting but no module imports a
Redis client, so running one would add an idle container and an unnecessary
attack surface. Add it back only when something actually connects to it.

Indicative recurring cost (verify current pricing before committing):

| Item | Monthly |
| --- | --- |
| VPS, 2 vCPU / 4 GB (Hetzner CPX21 class) | ~€8 |
| VPS, 2 vCPU / 4 GB (DigitalOcean/Vultr class) | ~$24 |
| Off-host backup storage, 50 GB | ~$1–5 |
| Vercel Pro (only if the frontend needs it) | $20 |
| **Total, excluding Vercel** | **~$10–30** |

No infrastructure was purchased or provisioned for this milestone.

## 2. Architecture

```
Browser ──HTTPS──> Vercel (Next.js)
                     │  server-side only:
                     │  WANDS_ENGINE_TOKEN
                     ▼
              HTTPS + TLS ──> Caddy/nginx on the VPS  (443)
                                 │  proxy to 127.0.0.1:8000
                                 ▼
                            engine container
                                 │  internal docker network
                                 ▼
                            postgres container
```

Properties this design depends on:

- The browser never holds the engine token and never reaches the engine.
- PostgreSQL publishes **no host port**. It is reachable only on the compose
  `internal` network.
- The engine binds `127.0.0.1:8000` only. It is never published publicly.
- TLS terminates at the reverse proxy on the VPS.

### Firewall

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp                 # restrict to the operator's IP if possible
ufw allow 443/tcp                # reverse proxy only
ufw enable
```

Do not open 5432 or 8000. Verify from outside the host:

```bash
nmap -Pn -p 22,443,5432,6379,8000 <host>
# 5432, 6379 and 8000 must be closed or filtered
```

## 3. Connecting the frontend

The Vercel frontend cannot reach `localhost` on a separate VPS, so the engine
must be reachable over TLS at a real hostname.

On the VPS, put a TLS reverse proxy in front of the loopback port. A minimal
Caddyfile:

```
engine.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

On the Vercel project, set:

| Variable | Value | Scope |
| --- | --- | --- |
| `WANDS_ENGINE_URL` | `https://engine.example.com` | server only |
| `WANDS_ENGINE_TOKEN` | same value as on the host | server only |
| `WANDS_OPERATOR_PASSWORD` | operator sign-in password | server only |
| `WANDS_SESSION_SECRET` | 32+ random bytes | server only |

None of these may be prefixed with `NEXT_PUBLIC_`.

### The operator gate is not optional

`/api/wands/*` forwards to the engine with the server-side admin token. Without
a gate, anyone who can load the site can pause trading, change the risk policy
or start a backfill. The middleware in `middleware.ts` requires a signed
operator session for every proxied request.

- With `WANDS_OPERATOR_PASSWORD` and `WANDS_SESSION_SECRET` set, the gate is
  enforced and operators sign in at `/login`.
- With them unset, the gate is open in development and **fails closed (503) in
  production**. A production deployment that has not configured the gate cannot
  reach the engine at all. That is deliberate.

### Restricting who can reach the engine

The engine token is a bearer credential. Defence in depth, in order of value:

1. **TLS everywhere.** Never expose port 8000 directly.
2. **Allowlist Vercel's egress** at the reverse proxy if your plan provides
   static egress addresses. Vercel egress ranges change, so treat this as
   hardening, not as the primary control.
3. **Rotate the token** on a schedule (section 5).
4. **mTLS** between Vercel and the proxy is possible but requires a custom
   fetch agent; it is not implemented here.

Verify connectivity from the actual frontend runtime, not from your laptop:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<frontend>/api/wands/engine/status
# 401 without an operator session, 200 with one
```

## 4. First deployment

```bash
# 1. Host hardening (once)
adduser --disabled-password --gecos "" wands
usermod -aG sudo wands
# SSH: disable password auth, disable root login, install fail2ban, enable ufw

# 2. Install Docker Engine + compose plugin, then as the wands user:
git clone https://github.com/ethersns/wands.git
cd wands/backend

# 3. Secrets
cp .env.example .env
chmod 600 .env
python3 -c "import secrets; print('WANDS_ENGINE_TOKEN=' + secrets.token_urlsafe(48))"
python3 -c "from cryptography.fernet import Fernet; print('WANDS_ENCRYPTION_KEY=' + Fernet.generate_key().decode())"
python3 -c "import secrets; print('WANDS_API_KEY_PEPPER=' + secrets.token_urlsafe(32))"
python3 -c "import secrets; print('WANDS_SESSION_SECRET=' + secrets.token_urlsafe(32))"
# paste those into .env, set POSTGRES_PASSWORD, WANDS_ALLOWED_ORIGINS,
# WANDS_OPERATOR_PASSWORD, and WANDS_ENVIRONMENT=production

# 4. Start. `migrate` runs first and the engine waits for it to succeed.
docker compose up -d --build
docker compose ps
```

Migrations are **not** run by the engine container. They are a discrete
`migrate` service that runs once per `up`, so a restart can never apply a schema
change nobody asked for.

## 5. Secret management

- `.env` is `chmod 600`, owned by the `wands` user, and never committed.
- For a managed secret store, inject the values as environment variables from
  the provider's agent (AWS Secrets Manager, Doppler, Vault) instead of a file.
  The engine reads only environment variables, so no code change is needed.
- `WANDS_ENCRYPTION_KEY` protects broker credentials at rest. **Rotating it
  requires re-encrypting every `connections.credentials_encrypted` value**;
  there is no automatic migration. Plan it as a maintenance window.
- `WANDS_ENGINE_TOKEN` rotation: set the new value on the host, restart the
  engine, then update Vercel. There is a brief window where the old token is
  rejected — do it during a quiet period.
- `WANDS_SESSION_SECRET` rotation signs every operator out. Do it after any
  suspected session compromise.
- `WANDS_OPERATOR_PASSWORD` rotation takes effect immediately for new sign-ins;
  existing sessions remain valid until they expire (8 hours) or the session
  secret is rotated.

## 6. Migrations

```bash
# Apply pending migrations (also runs automatically on `docker compose up`)
docker compose run --rm migrate

# Show the current revision
docker compose run --rm migrate alembic current

# Roll back one revision
docker compose run --rm migrate alembic downgrade -1

# Roll forward again
docker compose run --rm migrate alembic upgrade head
```

The test suite runs `upgrade → downgrade → upgrade` on every run, so a migration
that cannot be reversed fails before it reaches the host.

**A production host refuses to start on SQLite.** If `WANDS_DATABASE_URL` is
missing or wrong, the engine exits rather than creating an empty database and
serving it as though it were real state.

## 7. Backups and restore

```bash
# One-shot logical backup into ./backups
docker compose run --rm backup

# Nightly from host cron (02:15 UTC), keeping 30 days
15 2 * * * cd /home/wands/wands/backend && docker compose run --rm backup \
  && find ./backups -name 'wands-*.dump' -mtime +30 -delete
```

Copy dumps off-host and encrypt them (`age`, `gpg`). A backup that has never
been restored is not a backup.

Restore:

```bash
docker compose stop engine
docker compose run --rm -T postgres pg_restore \
  -h postgres -U wands -d wands --clean --if-exists < backups/wands-<stamp>.dump
docker compose start engine
curl -fsS http://127.0.0.1:8000/readyz
```

After a restore, check `GET /v1/engine/status`: if the emergency stop was
engaged at backup time it will still be engaged, which is the correct
conservative outcome.

## 8. Health verification

```bash
# Liveness and readiness
curl -fsS http://127.0.0.1:8000/healthz
curl -fsS http://127.0.0.1:8000/readyz

# Full deployment check, including an end-to-end denial audit
docker compose exec engine python -m scripts.verify_deployment --probe
```

`verify_deployment` checks the database, the migration revision, the
append-only audit trigger, that live trading is off in both the database and the
deployment, that an admin exists, and — with `--probe` — that a permission
denial reaches the durable audit trail. Exit code 0 means every check passed.

## 9. Monitoring and alerts

| Signal | Source | Alert when |
| --- | --- | --- |
| Liveness | `GET /healthz` | 2 consecutive failures |
| Readiness | `GET /readyz` | non-200 for 2 minutes |
| Engine state | `GET /v1/engine/status` | `state = degraded` > 2 min |
| Emergency stop | `GET /v1/engine/status` | `emergencyStopEngaged = true` |
| Rejections | `GET /v1/engine/security` | `rejectionsSinceStart.unauthorized` climbing |
| Denials | `GET /v1/engine/security` | `denialsRecorded` rising unexpectedly |
| Audit write failure | log `event=audit.denial_write_failed` | any occurrence |
| SEC freshness | `GET /v1/intelligence/status` | no successful ingest in 2× interval |
| Failed jobs | `GET /v1/intelligence/jobs` | `status = failed` or `failures >= max` |
| Market data | `GET /v1/markets/health` | provider unreachable 2 cycles |
| Disk | host | > 80% used |
| Backup | cron exit code | any non-zero exit |
| Audit integrity | `verify_deployment` | `audit append-only` check fails |

Logs are JSON on stdout with a `request_id` on every line. Set
`WANDS_OTEL_EXPORTER_OTLP_ENDPOINT` to export traces to any OTLP collector.

Container logs are capped (`max-size`/`max-file` in compose) so a log storm
cannot fill the disk.

**Application availability is not evidence that trading execution is ready.**
`/healthz` returning 200 says the process is up, nothing more.

## 10. Disaster-recovery drills

Run these before trusting the host. Results below are from a local PostgreSQL
15.19 instance, not from a production VPS.

| Drill | Procedure | Result |
| --- | --- | --- |
| Migration rollback | `alembic downgrade -1` then `upgrade head` | Passed: trigger dropped and recreated, data intact |
| Backup restore | `pg_dump -Fc` then `pg_restore` into a separate database | Passed: rows, revision and trigger all restored |
| PostgreSQL outage | point the engine at a closed port | Passed: `/readyz` 503, protected routes 500, never 200 |
| Audit tampering | `UPDATE`/`DELETE` on `audit_events` | Passed: both rejected by trigger |
| Denial auditing | viewer hits an admin route | Passed: 403 and an `authorization.denied` row |
| Audit store down | make the audit session raise | Passed: still 403, alert logged |
| Engine token rotation | change `WANDS_ENGINE_TOKEN`, restart | Not run on a host; procedure in section 5 |
| Container restart | `docker compose restart engine` | Not run: no Docker in the build environment |
| Redis outage | n/a | Not applicable: no Redis client exists |

## 11. SEC ingestion

Collection is **off by default** (`WANDS_INTELLIGENCE_INGEST_ENABLED=false`,
`WANDS_INTELLIGENCE_JOBS_ENABLED=false`, `WANDS_INTELLIGENCE_BACKFILL_ENABLED=false`).

Before enabling collection, set a real contact:

```bash
WANDS_SEC_USER_AGENT="wands-research/0.1 (ops@your-domain.example)"
```

The engine **refuses to start** with ingestion enabled while the user agent
still carries the shipped placeholder (`ops@example.com`). It validates rather
than substitutes: inventing a contact would be worse than refusing.

`WANDS_INTELLIGENCE_INGEST_ENABLED` is enforced at the collector, not only at
startup. Every path that can reach the SEC — the scheduler, the CLI and the
backfill runner — passes through `ingest_disabled_reason()`, so a host that
never set the flag collects nothing and reports `stage: config` instead. This
matters because `WANDS_INTELLIGENCE_ENABLED` defaults to true: without the
second switch, a deployment that only left the default alone would have started
collecting.

Operational properties already implemented:

- **No overlapping jobs.** A job starts only by atomically claiming a row whose
  lease has expired or was never taken, so two processes on the same database
  cannot both run the same crawl.
- **Restart-safe.** `recover()` reclaims jobs whose lease outlived the process
  that held them, so an interrupted crawl is visible rather than silently
  skipped.
- **Bounded backfills.** `WANDS_INTELLIGENCE_BACKFILL_START_DATE` /
  `_END_DATE` bound the range and `WANDS_INTELLIGENCE_INSIDER_CIKS` /
  `_INSTITUTION_CIKS` bound the issuer list. Do not run a large historical
  backfill automatically; start with a narrow window and a short issuer list.
- **Rate limits.** `WANDS_SEC_RATE_LIMIT_PER_SECOND` (default 5, half the
  published ceiling) and `WANDS_SEC_MAX_RETRIES` are read by `build_client()`
  and applied to the token bucket and retry policy. They are deployment
  settings, not constants in the transport.
- **Provenance.** Each ingested record stores its source document and filing
  date, so a figure can be traced back to the filing it came from.

## 12. Upgrading and rollback

```bash
git pull
docker compose build engine
docker compose run --rm migrate      # apply schema changes explicitly
docker compose up -d engine
docker compose exec engine python -m scripts.verify_deployment
```

Rollback:

```bash
docker compose run --rm migrate alembic downgrade -1
docker compose up -d engine          # with the previous image tag
```

Keep the previous image (`docker tag wands-engine:previous`) before upgrading so
a rollback does not require a rebuild.

## 13. What is deliberately not enabled

Live trading. `WANDS_LIVE_TRADING_ENABLED=false` and
`engine_state.live_trading_enabled=false`. Enabling it requires the Phase 9
readiness work described in `06-implementation-plan.md` — a reconciliation
worker, a verified live adapter, and a kill-switch drill. Do not enable it
because the flag exists.
