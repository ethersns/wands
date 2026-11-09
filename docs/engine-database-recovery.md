# Engine database recovery plan

Read-only analysis of the two databases the Wands engine could use, and a
recommendation for preserving the genuine research data already collected.

Governed by **WANDS RULE 002** in `AGENTS.md`. Every number below was read from
the live Neon project on **2026-11-09** with `SELECT` statements only. No write,
migration, ingestion, credential rotation, environment change, table drop or
cutover was performed.

- **Repository head:** `7edc225` (`main`)
- **Alembic head in the repository:** `b8d3f5a1c927`
- **Method:** direct read-only queries against both databases on the same Neon
  project, plus inspection of `backend/alembic/versions/`.
- **Not printed:** connection strings, passwords, key material, or row-level
  personal records. Only aggregate counts and schema metadata were read.

---

## 1. Verified identities

| | `neondb` | `wands_engine` |
| --- | --- | --- |
| Server | PostgreSQL 18.6, same Neon project | PostgreSQL 18.6, same Neon project |
| Role used | `neondb_owner` | `neondb_owner` |
| Databases on the server | `neondb`, `postgres`, `wands_engine` | — |

Both databases are on one server with one credential. `wands_engine` is a
separate database, not a separate project, so a copy between them is a
server-local operation with no network transfer and no new cost.

**VERIFIED.**

---

## 2. Migration revisions

The repository chain is linear with a single head:

```
30aab3f55099  initial schema
7c1d4a9e2b30  phase 3: market data, portfolio accounting, paper accounts
9b4e2c7d1a05  intelligence v1: SEC ownership filings, 13F holdings, signals
c3f8a1d6e204  intelligence v1.1: backfill cursors, identifiers, jobs, experiments
d4a7b2c9e815  audit integrity: audit_events append-only
e5b9c3d1f726  price history adjustment and coverage
f1a2b3c4d5e6  performance lab evidence capture
a7c4e2b91f38  opportunity desk research records
b8d3f5a1c927  index institutional holdings by filer and quarter   <- head
```

| Database | Recorded revision | Revisions behind head |
| --- | --- | --- |
| `neondb` | `e5b9c3d1f726` | 3 (`f1a2b3c4d5e6`, `a7c4e2b91f38`, `b8d3f5a1c927`) |
| `wands_engine` | `a7c4e2b91f38` | 1 (`b8d3f5a1c927`) |

`b8d3f5a1c927` is additive and reversible: it creates one index,
`ix_intel_institutional_holdings_institution_period`, and nothing else.

**VERIFIED.**

---

## 3. Table inventory and row counts

### Research data

| Table | `neondb` | `wands_engine` |
| --- | --- | --- |
| `intel_institutions` | **4** | 0 |
| `intel_institutional_holdings` | **80,684** | 0 |
| `intel_signals` | **4** | 0 |
| `intel_experiments` | **13** | 0 |
| `intel_security_identifiers` | **916** | 0 |
| `intel_ingest_runs` | **4** | 0 |
| `market_candles` | **6,611** | 0 |
| `market_quotes` | **1,104** | 0 |
| `market_price_coverage` | **13** | 0 |
| `intel_filings` | 0 | 0 |
| `intel_insider_transactions` | 0 | 0 |
| `intel_signal_outcomes` | 0 | 0 |
| `intel_jobs` | 0 | 0 |
| `intel_job_failures` | 0 | 0 |
| `intel_backfill_checkpoints` | 0 | 0 |

### Operational and trading state

| Table | `neondb` | `wands_engine` |
| --- | --- | --- |
| `users` | 2 | 1 |
| `user_settings` | 1 | 1 |
| `engine_state` | 1 | 1 |
| `audit_events` | 14 | 2 |
| `strategies` | 7 | 7 |
| `risk_policies` | 1 | 1 |
| `api_keys` | **2** | 0 |
| `orders`, `fills`, `positions` | 0 | 0 |
| `backtests`, `bots`, `bot_logs` | 0 | 0 |
| `connections`, `account_balances`, `equity_snapshots` | 0 | 0 |
| `risk_events` | 0 | 0 |

### Schema objects present in one database only

| Object | `neondb` | `wands_engine` |
| --- | --- | --- |
| `perf_*` (6 tables: `perf_audit_events`, `perf_evaluation_jobs`, `perf_evidence_records`, `perf_recorded_signals`, `perf_signal_evaluations`, `perf_strategy_versions`) | **absent** | present (empty) |
| `opp_candidates`, `opp_decisions`, `opp_paper_tests` | **absent** | present (empty) |

**VERIFIED.** These counts match the table in
`docs/railway-deployment.md` section 4 exactly, which was written from an earlier
independent read. Two independent reads agreeing is the strongest evidence
available without a deployed engine.

---

## 4. Which tables hold genuine research records

Only `neondb` holds genuine research records. The substantive ones are:

- `intel_institutional_holdings` — 80,684 13F position rows. This is the single
  largest and most expensive asset to recollect, because it is built from SEC
  bulk filings over many quarters.
- `market_candles` — 6,611 adjusted candles, plus `market_quotes` (1,104) and
  `market_price_coverage` (13).
- `intel_security_identifiers` — 916 ticker/CIK mappings, which are the join key
  between filings and symbols.
- `intel_institutions` (4 filers), `intel_signals` (4), `intel_experiments` (13),
  `intel_ingest_runs` (4).

`wands_engine` holds **no** research records. Every research table there is
empty.

---

## 5. Which tables hold keys, secrets or sensitive operational state

- `api_keys` — 2 rows in `neondb`, 0 in `wands_engine`. Columns are `id`,
  `user_id`, `name`, `key_prefix`, `key_hash`, `role`, `scopes`, `created_at`,
  `last_used_at`, `revoked_at`. Only a SHA-256 **hash** is stored, never the key
  itself. Both rows have `role = viewer`, `scopes` of type `json`, and neither is
  revoked. These are the research-scoped credentials the Vercel app uses.
- `audit_events` — 14 rows in `neondb`, 2 in `wands_engine`. Append-only by
  database trigger in both.
- `engine_state`, `risk_policies`, `user_settings` — one row each in both. These
  are bootstrap state, not research.

No plaintext secret was read or printed during this analysis.

---

## 6. Does the destination hold newer or independently valuable records?

`wands_engine` is not literally empty. It holds 1 `users` row, 1
`user_settings`, 1 `engine_state`, 2 `audit_events`, 7 `strategies` and 1
`risk_policies`. These are bootstrap/seed rows produced by the engine's own
startup, not research.

Consequences for a copy:

- `strategies` has 7 rows in **both** databases. A blind copy would collide on
  the primary key. Strategies are seed data, so the copy must **not** target this
  table.
- The 1 `users` row in `wands_engine` is a different account from either of the
  2 in `neondb` (see section 7). It must not be overwritten.

**VERIFIED.**

---

## 7. Foreign-key and ID dependencies

Engine-internal foreign keys (all satisfied by copying in dependency order):

| Child | Column | Parent |
| --- | --- | --- |
| `intel_institutional_holdings` | `institution_id` | `intel_institutions` |
| `intel_insider_transactions` | `filing_id` | `intel_filings` |
| `intel_signal_outcomes` | `signal_id` | `intel_signals` |
| `intel_signal_outcomes` | `experiment_id` | `intel_experiments` |
| `opp_decisions` | `candidate_id` | `opp_candidates` |
| `opp_paper_tests` | `candidate_id` | `opp_candidates` |

The one **cross-boundary** foreign key is the blocker:

| Child | Column | Parent | Problem |
| --- | --- | --- | --- |
| `api_keys` | `user_id` | `users` | The 2 key owners in `neondb` do **not** exist in `wands_engine` (0 of 2 present). |

So `api_keys` cannot be copied as-is: it would violate its foreign key, and
satisfying it would mean copying application user rows into the engine database —
recreating exactly the schema mixing this separation exists to prevent.

**Recommendation:** do not copy `api_keys`. Mint a fresh research key inside
`wands_engine` with `python -m scripts.create_research_key`, which creates its own
engine-side user row. The engine database then stays self-contained.

**VERIFIED.**

---

## 8. Sequence values and identity columns

No engine table uses a sequence or an identity column. The only sequence-backed
columns in `neondb` are `admin_audit_log.id`, `engine_state.id`,
`member_login_event.id`, `member_security_event.id` and `site_page_view.id` —
none of which are engine research tables.

Every engine research table uses a `uuid` primary key with **no default**
(`intel_institutions`, `intel_institutional_holdings`, `intel_signals`,
`intel_experiments`, `intel_security_identifiers`, `intel_ingest_runs`,
`market_candles`, `market_quotes`, `market_price_coverage`).

Consequence: a copy must supply explicit IDs, and there is **no sequence to
reset** afterwards. This removes the most common post-copy failure mode.

**VERIFIED.**

---

## 9. Data provenance and publication timestamps

The research rows carry their own provenance columns (`accepted_at`,
`public_available_at`, `period_of_report`, `observed_at`, `created_at`). A copy
preserves them verbatim because it copies column values, not derived state.

No timestamp is rewritten, and no row is re-dated. The engine's freshness
reporting reads these columns, so a copied row reports the same age it did in the
source.

---

## 10. Duplicate records and conflict behaviour

- Destination research tables are empty, so a copy into them cannot conflict.
- `strategies` is the only table with equal non-zero counts in both (7 and 7) and
  must be excluded from the copy.
- Recommended copy semantics: `INSERT ... ON CONFLICT (id) DO NOTHING`, so a
  re-run is idempotent and cannot overwrite a destination row that appeared
  between the backup and the copy.

---

## 11. Post-transfer validation

Run after the copy, before any cutover:

1. Per-table row counts equal the source counts in section 3.
2. `select count(*) from intel_institutional_holdings h
   left join intel_institutions i on i.id = h.institution_id
   where i.id is null` returns 0 (no orphan holdings).
3. The same orphan check for `intel_signal_outcomes` against `intel_signals` and
   `intel_experiments`.
4. `select count(distinct symbol) from intel_security_identifiers` equals the
   source value.
5. `python -m scripts.verify_deployment` against `wands_engine` passes.
6. `GET /v1/intelligence/institutions` and `/signals` return the copied rows with
   `provenance: live`, not `unavailable`.

---

## 12. Backup and recovery

- **Before any write:** create a Neon branch (instant, no cost on the free plan)
  of the project, or a restore point. This is the rollback for both databases at
  once.
- The copy itself is additive into empty tables, so the source is never modified.
- `neondb`'s engine tables are **not** dropped as part of this plan. They stay as
  the fallback until the engine is verified against `wands_engine`.

---

## 13. Cutover requirements

1. Owner approval for the write (section 15).
2. Neon branch taken.
3. `b8d3f5a1c927` applied to `wands_engine` so it reaches head.
4. Research tables copied in dependency order, in one transaction.
5. Validation in section 11 passes.
6. A research key minted in `wands_engine`.
7. `WANDS_DATABASE_URL` on the engine service pointed at `wands_engine`.
8. `WANDS_RESEARCH_TOKEN` on Vercel replaced with the new key.
9. `WANDS_ENGINE_URL` on Vercel set to the deployed engine.

Steps 7-9 are environment changes and are **not** part of this task.

---

## 14. Rollback

- **Bad copy:** restore the Neon branch. The source was never modified.
- **Bad cutover:** point `WANDS_DATABASE_URL` back at `neondb`. The engine tables
  there are untouched, so this is a configuration revert, not a data restore.
- **Frontend:** unset `WANDS_ENGINE_URL`. Member research returns to the designed
  `unavailable` state rather than erroring.

---

## 15. Expected cost and service interruption

- **Cost:** none. Both databases are on the same existing Neon project and the
  same free-plan allowance. No new service, no new chargeable resource.
- **Interruption:** none to the website. The engine is not deployed, so there is
  no running engine to interrupt. The copy is a few tens of thousands of rows on
  a server-local connection.

---

## 16. Is the production engine connected to either database?

**UNVERIFIED.** There is no Railway access in this environment, and
`docs/railway-deployment.md` records the engine as "prepared, not deployed". In
this environment `WANDS_ENGINE_URL` and `WANDS_RESEARCH_TOKEN` are **unset**, so
the Next.js app here cannot reach any engine and member research renders
`unavailable` by design.

Whether a deployed engine exists and which database it points at cannot be
determined from the repository. The owner must confirm it before step 7.

---

## Recommendation

**Make `wands_engine` the engine's system of record, and move the genuine
research data into it from `neondb` in one approved, additive copy.**

The evidence for this over the alternative (pointing the engine at `neondb`):

1. **The destination is already correct and empty.** `wands_engine` has all 45
   engine tables, the `perf_*` and `opp_*` tables that `neondb` lacks, and zero
   research rows. There is nothing to overwrite and nothing to reconcile.
2. **The source is the wrong shape.** `neondb` is 3 revisions behind head and is
   missing the performance-lab and opportunity-desk tables entirely. Pointing the
   engine at it would mean applying three migrations to the *application*
   database, mixing two schemas and making a rollback of either one unsafe — the
   exact failure the separation exists to prevent.
3. **The data is small and bounded.** 80,684 holdings, 6,611 candles, 1,104
   quotes, 916 identifiers, 4 signals, 13 experiments, 4 institutions, 13
   coverage rows, 4 ingest runs. This is a tractable copy that can be counted and
   verified row for row.
4. **The copy is one-way into an empty target.** No conflict, no merge, no
   deletion, and the source is left intact as the fallback.
5. **No sequence reset is needed**, because every engine primary key is a UUID
   with no default.

The one thing that must **not** be copied is `api_keys`, because its foreign key
points at application `users` rows that do not exist in the destination. Mint a
fresh research key in `wands_engine` instead.

### Remaining risks

- The engine's current database binding is unverified (section 16). If a deployed
  engine is already writing to `neondb`, the copy must be taken after it is
  stopped, or the two will diverge.
- `intel_insider_transactions` and `intel_filings` are empty in both databases, so
  the insider surface will remain empty after the copy. That is a collection gap,
  not a migration defect.
- The copy is a production write and requires the approval in section 15.

---

## Owner approvals needed

1. **Approve the copy** of the research tables from `neondb` to `wands_engine`
   (a production write). Nothing in this document has been executed.
2. **Confirm the engine's current database binding**, or confirm no engine is
   deployed.
3. **Approve minting a new research key** in `wands_engine` and replacing
   `WANDS_RESEARCH_TOKEN` on Vercel.
4. **Approve the environment changes** in section 13, steps 7-9.

No irreversible operation is proposed. Dropping the engine tables from `neondb`
is deliberately **not** part of this plan and would be a separate, later request.
