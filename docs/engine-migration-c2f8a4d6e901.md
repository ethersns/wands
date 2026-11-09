# Engine migration to head: `c2f8a4d6e901`

**Status: prepared, not executed.** No migration has been run. No application
database change, no feature change, no new infrastructure, no live trading.

Governed by **WANDS RULE 002**. Every fact below was read from the live Neon
project on **2026-11-09** with `SELECT` statements only, or from the repository
at `692e13c` (`main`, PR #56 merged). Connection strings, passwords and key
material are not reproduced here.

---

## 1. Scope

Two revisions are pending on `wands_engine`:

| Revision | Description | Effect |
| --- | --- | --- |
| `b8d3f5a1c927` | index institutional holdings by filer and quarter | creates one index |
| `c2f8a4d6e901` | durable, fenced opportunity scan checkpoint | creates one table and seeds one row |

Both are additive. Neither drops, renames or rewrites a column, and neither
touches a trading table (`orders`, `fills`, `positions`, `risk_policies`,
`engine_state`).

`neondb` is **out of scope** and is not modified by this plan.

---

## 2. Verified state

Read directly from the Neon project `sparkling-feather-63643845`
(`neon-emerald-yacht`), PostgreSQL 18.6, branch `main`
(`br-winter-grass-bb409wmc`).

| | `wands_engine` | `neondb` |
| --- | --- | --- |
| `alembic_version` | `a7c4e2b91f38` | `e5b9c3d1f726` |
| `ix_intel_institutional_holdings_institution_period` | absent | absent |
| `opp_scan_state` | absent | absent |
| `intel_institutional_holdings` rows | 0 | 80,684 |
| `strategies` rows | 7 | 7 |
| `live_trading_enabled` (`engine_state` id 1) | `false` | — |

**Both pending revisions are confirmed pending on `wands_engine`.** The
recorded revision is exactly `a7c4e2b91f38`, and neither object the two
revisions create exists.

### Migration preconditions

| Precondition | Result |
| --- | --- |
| `intel_institutional_holdings` exists | yes |
| `institution_id` and `period_of_report` columns exist | yes, both |
| Index name not already taken | yes, absent |
| `opp_scan_state` not already present | yes, absent |
| Table being indexed is empty | yes, 0 rows |

The index build is therefore instant and cannot block on a long table scan.

### Chain

Linear, single head, no branch to reconcile:

```
f1a2b3c4d5e6  performance lab evidence capture
a7c4e2b91f38  opportunity desk research records          <- current
b8d3f5a1c927  index institutional holdings by filer      <- pending
c2f8a4d6e901  opportunity scan checkpoint                <- pending, head
```

---

## 3. Recovery point

A copy-on-write branch was created before any migration work:

| | |
| --- | --- |
| Branch | `pre-migration-c2f8a4d6e901` |
| Branch ID | `br-soft-dust-bbb7jlkb` |
| Parent | `main` (`br-winter-grass-bb409wmc`) |
| Parent LSN | `0/7640A80` |
| Created | 2026-11-09T15:47:46Z |

**Verified contents of the recovery point** (read-only queries against the
branch):

| Check | Result |
| --- | --- |
| `wands_engine` `alembic_version` | `a7c4e2b91f38` |
| `wands_engine` `intel_institutional_holdings` | 0 rows |
| `wands_engine` `strategies` | 7 rows |
| `wands_engine` `opp_scan_state` | absent |
| `neondb` `intel_institutional_holdings` | 80,684 rows |
| `neondb` `market_candles` | 6,731 rows |
| `neondb` `api_keys` | 2 rows |

The branch clones both databases at the same instant, so it is a rollback for
either one. It is non-destructive, costs nothing on the free plan, and can be
deleted once the migration is confirmed.

**Point-in-time restore alone is not sufficient:** the project's
`history_retention_seconds` is `21600` (6 hours). A migration discovered to be
wrong the next day would be outside that window. The branch is the durable
recovery point; PITR is the short-term one.

---

## 4. Blocker: the Railway database binding is UNVERIFIED

The premise that Railway runs against `wands_engine` **could not be confirmed in
this environment**, and there is evidence pointing the other way.

What is unavailable:

- No Railway tool, CLI, API token or project access exists here.
- `WANDS_ENGINE_URL` is unset in this environment, so no deployed engine can be
  reached to interrogate it.
- The engine exposes no endpoint that reports its database identity. `/healthz`
  returns a static payload and `/readyz` only runs `SELECT 1`.

What the data shows:

| Observation | Value |
| --- | --- |
| `wands_engine` last `audit_events` write | 2026-11-08T22:56:58Z |
| `wands_engine` `engine_state.updated_at` | 2026-11-08T22:56:01Z |
| `neondb` `market_candles` last `ingested_at` | **2026-11-09T14:19:59Z** |
| Rows written in that batch | 60 `BTC/USD` 5m + 60 `ETH/USD` 5m |
| `neondb` `market_quotes` last `ingested_at` | 2026-11-07T23:19:10Z |
| `neondb` `intel_ingest_runs` last run | 2026-11-07T20:52:19Z |

The Next.js application never writes `market_candles` (the only reference
outside `backend/` is documentation), and the project has no Vercel cron. So the
120 candle rows written to `neondb` today came from engine code — either a
deployed service or a local run by the owner.

`wands_engine`'s last write is consistent with the local verification run
recorded in `docs/railway-deployment.md` section 6, not with a live service.

**Consequence:** if a deployed engine is writing to `neondb`, then migrating
`wands_engine` does not bring the running system to head, and the two databases
continue to diverge. This must be resolved before the upgrade is worth running.

### How to resolve it

On the Railway service, read the variable without printing the password:

```bash
railway variables --service <engine-service> | grep -E 'WANDS_DATABASE_URL|PGDATABASE'
```

or, from a Railway shell:

```bash
python -c "from wands.config import get_settings; from sqlalchemy import create_engine, text; \
e=create_engine(get_settings().database_url); \
print(e.connect().execute(text('select current_database(), (select version_num from alembic_version)')).one())"
```

Expected if the premise holds: `('wands_engine', 'a7c4e2b91f38')`.

---

## 5. Upgrade procedure

Run from a machine that can reach the database, with the backend dependencies
installed (`alembic`, `sqlalchemy`, `psycopg[binary]`). Migrations are
deliberately not run on container start.

Use the **direct** (non-pooler) host for migrations. The pooled host runs
pgbouncer, which is the wrong place for DDL and advisory locks.

```bash
cd backend
export WANDS_DATABASE_URL='postgresql+psycopg://<user>:<password>@<direct-host>/wands_engine'

# 1. Confirm the target before touching it.
python -m alembic current          # expect a7c4e2b91f38
python -m alembic heads            # expect c2f8a4d6e901 (single head)

# 2. Show exactly what will run.
python -m alembic history -r a7c4e2b91f38:head

# 3. Apply. Both revisions run in one transaction; a failure rolls back both.
python -m alembic upgrade head

# 4. Confirm.
python -m alembic current          # expect c2f8a4d6e901
```

`alembic/env.py` takes the URL from `get_settings().database_url`, so the
migration cannot be applied to a different database than the one the engine
connects to — provided `WANDS_DATABASE_URL` is the engine's real binding.

### Why this is the safe form

- Both revisions are additive; there is no data to lose.
- The indexed table is empty, so the index build is instant.
- `c2f8a4d6e901` seeds `opp_scan_state` with `id = 1` and `state = {}`; the
  table is absent, so the insert cannot conflict.
- Alembic runs the two revisions in a single transaction, so a partial upgrade
  is not a reachable state.
- No `downgrade` is planned. If the result is wrong, restore the branch.

---

## 6. Verification after the upgrade

```sql
-- recorded revision
select version_num from alembic_version;                       -- c2f8a4d6e901

-- index exists and is valid
select indexname, indexdef from pg_indexes
 where indexname = 'ix_intel_institutional_holdings_institution_period';

-- scan checkpoint seeded exactly once
select id, state, lease_owner from opp_scan_state;             -- one row, id 1, {}

-- nothing else changed
select count(*) from intel_institutional_holdings;             -- 0
select count(*) from strategies;                               -- 7
select live_trading_enabled from engine_state where id = 1;    -- false
```

Then, against the deployed engine:

```bash
python -m scripts.verify_deployment
```

`verify_deployment.py` fails the host if the database disagrees with
`WANDS_LIVE_TRADING_ENABLED=false`, so it doubles as the live-trading guard.

---

## 7. Rollback

| Failure | Action |
| --- | --- |
| Migration errors mid-run | Nothing to undo: the transaction rolled back. Read the failing revision and fix forward. |
| Migration succeeds but the engine misbehaves | Restore branch `br-soft-dust-bbb7jlkb`, or point `WANDS_DATABASE_URL` back at the pre-migration state. |
| Wrong database was migrated | Restore the branch. `neondb` was never touched by this plan. |

Do not `alembic downgrade` a revision that dropped a column. Neither pending
revision drops anything, so `downgrade` is technically available here, but the
branch restore is the safer and already-verified path.

---

## 8. Approval required

Nothing in this document has been executed against a database. The only action
taken was creating the recovery branch in section 3.

1. **Confirm the Railway binding** (section 4), or confirm no engine is
   deployed. This is the one open question that changes whether the upgrade is
   the right action at all.
2. **Approve running `alembic upgrade head`** against `wands_engine`.

`neondb` is not modified by either step.
