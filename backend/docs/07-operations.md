# Wands — Deployment and Operations

## 1. Host requirements

A single private VPS is enough for this build: 2 vCPU, 4 GB RAM, 40 GB SSD,
Ubuntu 24.04. The engine is a single process; PostgreSQL and Redis run beside
it in Docker.

The host must **not** expose PostgreSQL (5432), Redis (6379) or the Docker
socket to the internet. Only 443 (via a reverse proxy) or 8000 on a private
interface should be reachable, and only from the Vercel frontend's egress and
the operator VPN.

## 2. First deployment

```bash
# 1. Host hardening (once)
adduser --disabled-password --gecos "" wands
usermod -aG sudo wands
# SSH: disable password auth, disable root login, install fail2ban, enable ufw
ufw default deny incoming
ufw allow 22/tcp
ufw allow 443/tcp
ufw enable

# 2. Install Docker Engine + compose plugin, then as the wands user:
git clone https://github.com/ethersns/wands.git
cd wands/backend

# 3. Secrets
cp .env.example .env
chmod 600 .env
python3 -c "import secrets; print('WANDS_ENGINE_TOKEN=' + secrets.token_urlsafe(48))"
python3 -c "from cryptography.fernet import Fernet; print('WANDS_ENCRYPTION_KEY=' + Fernet.generate_key().decode())"
python3 -c "import secrets; print('WANDS_API_KEY_PEPPER=' + secrets.token_urlsafe(32))"
# paste those into .env, set POSTGRES_PASSWORD, set WANDS_ALLOWED_ORIGINS

# 4. Start
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:8000/healthz
```

Migrations run automatically on container start (`alembic upgrade head`).

## 3. Connecting the frontend

On the Vercel project, set:

| Variable | Value |
| --- | --- |
| `WANDS_ENGINE_URL` | `https://engine.<your-domain>` (or the private address) |
| `WANDS_ENGINE_TOKEN` | the same value as `WANDS_ENGINE_TOKEN` on the host |

Both are server-only. They must never be prefixed with `NEXT_PUBLIC_`, because
the browser must never hold the engine credential.

Verify from the frontend: the dashboard should stop showing the
"engine not configured" warning and start showing `provenance: live` figures.

## 4. Secret management

- `.env` is `chmod 600`, owned by the `wands` user, and never committed.
- For a managed secret store, mount the values as environment variables from
  the provider's agent (AWS Secrets Manager, Doppler, Vault) instead of a file.
  The engine reads only environment variables, so no code change is needed.
- `WANDS_ENCRYPTION_KEY` protects broker credentials at rest. **Rotating it
  requires re-encrypting every `connections.credentials_encrypted` value**;
  there is no automatic migration. Plan the rotation as a maintenance window.
- Rotate `WANDS_ENGINE_TOKEN` by setting the new value on the host, restarting
  the engine, then updating Vercel. There is a brief window where the old token
  is rejected — do it during a quiet period.

## 5. Backups

```bash
# Nightly encrypted logical backup
docker compose exec -T postgres pg_dump -U wands -Fc wands \
  | age -r <your-age-public-key> > /var/backups/wands-$(date +%F).dump.age
```

Keep 30 daily, 12 monthly, off-host. A backup that has never been restored is
not a backup: run the restore drill below quarterly.

## 6. Restore

```bash
docker compose stop engine
age -d -i <key> /var/backups/wands-2026-11-01.dump.age \
  | docker compose exec -T postgres pg_restore -U wands -d wands --clean --if-exists
docker compose start engine
curl -fsS http://127.0.0.1:8000/readyz
```

After a restore, check `GET /v1/engine/status`: if the emergency stop was
engaged at backup time it will still be engaged, which is the correct
conservative outcome.

## 7. Restart and recovery

| Situation | Action |
| --- | --- |
| Engine crash-loops | `docker compose logs --tail=200 engine`. The container restarts automatically; the emergency stop and pause flags are in the database, so a crash cannot silently re-enable trading. |
| Database unreachable | `/readyz` returns 503. The engine keeps serving `/healthz` but every data route fails closed. |
| Broker credentials compromised | Revoke at the venue first, then `DELETE /v1/connections/{id}`, then rotate `WANDS_ENCRYPTION_KEY` and re-enter credentials. |
| Suspected unauthorised trading | `POST /v1/risk/emergency-stop` immediately, then read `GET /v1/engine/audit`. |
| Host lost | Rebuild from the repo, restore the latest dump, re-enter `.env` secrets from the secret store. |

## 8. Monitoring

- `GET /healthz` — liveness. Alert if it fails twice in a row.
- `GET /readyz` — database reachability.
- `GET /v1/engine/status` — `state`, `activeBots`, `notes`.
- Logs are JSON on stdout; ship them with the platform's log driver.
- Set `WANDS_OTEL_EXPORTER_OTLP_ENDPOINT` to export traces to any OTLP
  collector.

Alert on: `emergency_stop_engaged = true`, `reconciliation = pending` older
than 5 minutes, `state = degraded` for more than 2 minutes, and any
`risk_events.severity = critical` row.

## 9. Upgrading

```bash
git pull
docker compose build engine
docker compose up -d engine     # migrations run on start
```

Migrations are reversible (`alembic downgrade -1`), and the test suite runs
`upgrade → downgrade → upgrade` on every run, so a broken migration fails CI
before it reaches the host.

## 10. Market data

Kraken public data needs no credentials. Alpaca stock data needs
`WANDS_ALPACA_DATA_KEY` and `WANDS_ALPACA_DATA_SECRET`; without them the stock
feed reports `unavailable` and the UI says so — it does not fall back to
invented prices.

```bash
# Confirm both providers are reachable and see the last successful fetch.
curl -s -H "Authorization: Bearer $WANDS_ENGINE_TOKEN" \
  https://engine.example.com/v1/markets/health | jq

# Force one ingestion pass (useful after a restart or a provider outage).
curl -s -X POST -H "Authorization: Bearer $WANDS_ENGINE_TOKEN" \
  https://engine.example.com/v1/markets/refresh | jq
```

The refresh worker runs inside the API process. If you would rather separate
ingestion, set `WANDS_MARKET_DATA_WORKER_ENABLED=false` and call
`POST /v1/markets/refresh` from cron or a scheduler at
`WANDS_MARKET_REFRESH_SECONDS`.

Alert on: `GET /v1/markets/health` reporting a provider as unreachable for more
than two refresh cycles, and any quote whose `ageSeconds` exceeds
`WANDS_MAX_ACCOUNT_STATE_AGE_SECONDS` while the engine is unpaused — that
combination means orders will start failing the freshness guard.

If the Alpaca account is not entitled to real-time SIP, set
`WANDS_ALPACA_DATA_DELAYED=true`. Leaving it `false` on a delayed plan would
label delayed data as live, which the platform must never do.

## 11. What is deliberately not enabled

Live trading. `WANDS_LIVE_TRADING_ENABLED=false` and
`engine_state.live_trading_enabled=false`. Enabling it requires the Phase 9
readiness work described in `06-implementation-plan.md` — a reconciliation
worker, a verified live adapter, and a kill-switch drill. Do not enable it
because the flag exists.
