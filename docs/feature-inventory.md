# Feature inventory

The maintained record of what Wands actually implements, what a member can
actually reach, and what is still missing. Governed by **WANDS RULE 001** in
`AGENTS.md`.

Update this file in the same change that adds or alters a customer-facing
capability. A row that says `missing-frontend` is a defect, not a note.

- **Last verified:** 2026-08-11
- **Engine commit:** `2b412a5` (branch `main`)
- **Verification method:** code inspection plus the test runs recorded in
  section 7. No engine was deployed and no production research request was made.

---

## 1. Availability states

| State | Meaning |
| --- | --- |
| `production-verified` | Deployed, reachable, exercised against real data |
| `local-verified` | Implemented and passing tests locally; not deployed |
| `missing-frontend` | Backend works; no member route or no navigation entry |
| `partial` | Some of the capability is implemented |
| `planned` | Designed, not implemented |
| `blocked` | Cannot proceed without data, infrastructure or a credential |

**Nothing in this repository is `production-verified`.** The engine has never
been deployed, so no capability has been exercised against real data in
production. Every engine-backed row is `local-verified` at best.

---

## 2. Feature-completion checklist

Copy this into the pull request or commit description for any change that adds
or alters a customer-facing capability.

```
Feature:
Backend implementation path:
API route / data contract:
Member route:
Navigation entry:
Public website location:
Availability status:
Test coverage:
Remaining blockers:
```

A change is not complete until every line is filled and the member route exists.
If the member route is deliberately deferred, the status is `missing-frontend`
and the row in section 3 says so.

---

## 3. Member-facing inventory

Member routes live under `app/app/`. Navigation entries are in
`components/member/member-shell.tsx`. Member code may only reach research
through `lib/member/research.ts`, which exposes customer-safe reads and nothing
else.

| Feature | Backend | API | Member route | Nav | Status |
| --- | --- | --- | --- | --- | --- |
| Research dashboard | `backend/wands/intelligence/member.py` | `GET /v1/intelligence/dashboard` | `/app` | Overview | `local-verified` |
| Asset research | `intelligence/research.py`, `member.py` | `GET /v1/intelligence/symbols/{symbol}/summary` | `/app/assets/[symbol]` | via Research | `local-verified` |
| Historical price research | `backend/wands/marketdata/` | `GET /v1/intelligence/symbols/{symbol}/prices` | `/app/assets/[symbol]` | via Research | `local-verified` |
| Insider Radar | `intelligence/ingest.py`, `forms.py`, `classify.py` | `GET /v1/intelligence/insiders`, `/insiders/{symbol}` | `/app/insiders` | Insiders | `local-verified` |
| Insider filing detail | `intelligence/member.py` | `GET /v1/intelligence/insiders/transactions/{id}` | `/app/insiders/[id]` | via Insiders | `local-verified` |
| Institutional Radar | `intelligence/institutions.py` | `GET /v1/intelligence/institutions` | `/app/institutions` | Institutions | `local-verified` |
| Research signals | `intelligence/signals.py`, `fusion.py` | `GET /v1/intelligence/signals`, `/signals/{id}` | `/app/signals`, `/app/signals/[id]` | Signals | `local-verified` |
| Signal validation | `intelligence/validation.py` | `GET /v1/intelligence/signals/{id}/validation` | `/app/signals/[id]` | via Signals | `local-verified` |
| Source provenance | `intelligence/member.py` | `GET /v1/intelligence/sources` | `/app/assets/[symbol]`, `/app/signals/[id]` | — | `local-verified` |
| Data coverage | `intelligence/freshness.py` | `GET /v1/intelligence/coverage/public` | `/app/research` | Research | `local-verified` |
| Quant Lab | `intelligence/quant.py`, `experiments.py`, `studies.py` | `POST /v1/intelligence/quant-lab/run`, `GET /experiments`, `/experiments/{id}` | `/app/quant-lab`, `/app/quant-lab/[id]` | Quant Lab | `local-verified` |
| Member watchlists | `lib/member/watchlists.ts` | `/api/member/watchlists` | `/app/watchlists` | Watchlists | `local-verified` |
| Saved research | `lib/member/saved.ts` | `/api/member/saved` | `/app/saved`, `/app/saved/[id]` | Saved | `local-verified` |
| Member alerts | `lib/member/alerts.ts` | `/api/member/alerts`, `/alerts/run` | `/app/alerts` | Alerts | `local-verified` |
| Notifications | `lib/member/notifications.ts` | `/api/member/notifications` | `/app/notifications` | Notifications | `local-verified` |
| Membership and billing | `lib/billing/` | `/api/billing/*` | `/app/membership` | Membership | `local-verified` |
| Account | `lib/member/account.ts` | `/api/member/account` | `/app/account` | Account | `local-verified` |
| Opportunity Desk | `backend/wands/opportunity/` | `/v1/opportunity/*` | `/app/opportunity` | Opportunity Desk (founder only) | `blocked` |

### Opportunity Desk

Implemented end to end, but `WANDS_FOUNDER_USER_IDS` is unset, so
`requireFounder()` grants nobody and the desk returns `unconfigured`. This is
fail-closed by design. It becomes usable when the founder's Better Auth user id
is set in the Vercel Production environment.

---

## 4. Operator-only inventory

These are internal. They are exempt from public marketing visibility but still
need operator observability. They are **not** part of the member research
contract and must never be linked from member navigation.

| Surface | Route | Guard |
| --- | --- | --- |
| Trading terminal | `app/(app)/*` | `requireOperator()` per page |
| Intelligence console | `app/(app)/intelligence/*` | `requireOperator()` |
| Data coverage (operator) | `app/(app)/intelligence/coverage` | `requireOperator()` |
| Operations | `app/(app)/intelligence/operations` | `requireOperator()` |
| Performance Lab | `app/(app)/intelligence/performance` | `requireOperator()` |
| Portfolio and risk | `app/(app)/portfolio`, `/risk` | `requireOperator()` |
| Bots and orders | `app/(app)/bots`, `/orders` | `requireOperator()` |
| Connections and settings | `app/(app)/connections`, `/settings` | `requireOperator()` |
| Owner Control Centre | `app/admin/*` | `requireAdmin()` |
| Engine proxy | `app/api/wands/[...path]` | `authorizeOperatorRequest()` |
| Research assistant | `app/api/research` | `authorizeOperatorRequest()` |

Engine routes other than `/v1/intelligence/*` are mounted with an
operator-only dependency in `backend/wands/api/router.py`: `engine`, `portfolio`,
`markets`, `strategies`, `bots`, `backtests`, `orders`, `risk`, `connections`,
`settings`, `performance`, `opportunity`. Only `intelligence` is mounted without
it, because it carries the member research surface.

---

## 5. Backend-to-frontend gaps

### Closed in this change

**Institutional Radar had no member surface.** The engine served
`GET /v1/intelligence/institutions`, `lib/api/research.ts` exposed
`getInstitutionFeed`, and `lib/member/research.ts` re-exported it as
`memberResearch.institutions` — but no member page consumed it and there was no
navigation entry. Meanwhile `app/(marketing)/features/page.tsx` advertised
"Institutional Radar" and `app/(auth)/signup/page.tsx` promised "Institutional
Radar and 13F position changes" to new signups. The product was selling a
capability the member workspace did not expose.

Added: `app/app/institutions/page.tsx`, `components/member/institution-row.tsx`,
and an `Institutions` entry in `MEMBER_NAV`.

### Open

| Gap | Detail | Status |
| --- | --- | --- |
| Institution drill-down | `GET /v1/intelligence/institutions/{cik}/changes` is served by the engine, but there is no member-safe client function and no member detail page. The list shows reported value, position count and public-availability date only. | `missing-frontend` |
| Engine not deployed | No `WANDS_ENGINE_URL` or `WANDS_RESEARCH_TOKEN` is configured, so every member research page renders the `unavailable` state. The engine itself now runs and answers correctly; it has no public host. See `docs/railway-deployment.md`. | `blocked` |
| Engine database prepared, not yet used | A separate `wands_engine` database exists on the Neon project with all 8 migrations applied (45 tables, at head `a7c4e2b91f38`). No engine is connected to it yet. | `local-verified` |
| Development shares the production database | The engine is isolated in `wands_engine`. The Next.js app still shares `neondb` between development and production. | `blocked` |

---

## 6. Frontend handoff

For the v0 frontend agent. Every entry below is a capability the engine already
serves. Do not build a surface for anything not listed here, and do not describe
a `blocked` row as available.

### Insider Radar

```
FEATURE NAME: Insider Radar
BACKEND LOCATION: backend/wands/intelligence/{ingest,forms,classify,member}.py
API ENDPOINT: GET /v1/intelligence/insiders, /insiders/{symbol}, /insiders/transactions/{id}
DATA CONTRACT: InsiderFeed, InsiderTransaction (lib/api/contracts.ts)
MEMBER PAGE: /app/insiders, /app/insiders/[id]
NAVIGATION LOCATION: MEMBER_NAV -> "Insiders"
PRODUCTION STATUS: local-verified
PUBLIC WEBSITE DESCRIPTION: "Insider Radar" (features page, signup page)
CURRENT LIMITATION: Renders unavailable until the engine is deployed
FRONTEND TASK REQUIRED: None
```

### Institutional Radar

```
FEATURE NAME: Institutional Radar
BACKEND LOCATION: backend/wands/intelligence/institutions.py
API ENDPOINT: GET /v1/intelligence/institutions
DATA CONTRACT: InstitutionFeed, Institution (lib/api/contracts.ts)
MEMBER PAGE: /app/institutions
NAVIGATION LOCATION: MEMBER_NAV -> "Institutions"
PRODUCTION STATUS: local-verified
PUBLIC WEBSITE DESCRIPTION: "Institutional Radar and 13F position changes" (signup page)
CURRENT LIMITATION: List only. No drill-down to /institutions/{cik}/changes.
FRONTEND TASK REQUIRED: Add a member detail page for 13F position changes once a
  member-safe client function exists for GET /v1/intelligence/institutions/{cik}/changes.
```

### Asset Research

```
FEATURE NAME: Asset Research
BACKEND LOCATION: backend/wands/intelligence/{research,member}.py
API ENDPOINT: GET /v1/intelligence/symbols/{symbol}/summary
DATA CONTRACT: AssetResearch (lib/api/research-contract.ts)
MEMBER PAGE: /app/assets/[symbol]
NAVIGATION LOCATION: via "Research" (/app/research)
PRODUCTION STATUS: local-verified
PUBLIC WEBSITE DESCRIPTION: asset research is described on the features page
CURRENT LIMITATION: Renders unavailable until the engine is deployed
FRONTEND TASK REQUIRED: None
```

### Historical Price Research

```
FEATURE NAME: Historical Price Research
BACKEND LOCATION: backend/wands/marketdata/
API ENDPOINT: GET /v1/intelligence/symbols/{symbol}/prices
DATA CONTRACT: PriceSeries (lib/api/research-contract.ts)
MEMBER PAGE: /app/assets/[symbol]
NAVIGATION LOCATION: via "Research"
PRODUCTION STATUS: local-verified
PUBLIC WEBSITE DESCRIPTION: not separately advertised
CURRENT LIMITATION: Requires a configured market-data provider
FRONTEND TASK REQUIRED: None
```

### Research Signals

```
FEATURE NAME: Research Signals
BACKEND LOCATION: backend/wands/intelligence/{signals,fusion,validation}.py
API ENDPOINT: GET /v1/intelligence/signals, /signals/{id}, /signals/{id}/validation
DATA CONTRACT: SignalFeed, ResearchSignal
MEMBER PAGE: /app/signals, /app/signals/[id]
NAVIGATION LOCATION: MEMBER_NAV -> "Signals"
PRODUCTION STATUS: local-verified
PUBLIC WEBSITE DESCRIPTION: described on the features page
CURRENT LIMITATION: A score is a bounded 0-100 ranking of evidence, never a
  probability or an expected return. Render null as "insufficient evidence".
FRONTEND TASK REQUIRED: None
```

### Quant Lab

```
FEATURE NAME: Quant Lab
BACKEND LOCATION: backend/wands/intelligence/{quant,experiments,studies,validation}.py
API ENDPOINT: POST /v1/intelligence/quant-lab/run, GET /experiments, /experiments/{id}
DATA CONTRACT: QuantExperiment, QuantExperimentFeed
MEMBER PAGE: /app/quant-lab, /app/quant-lab/[id]
NAVIGATION LOCATION: MEMBER_NAV -> "Quant Lab"
PRODUCTION STATUS: local-verified
PUBLIC WEBSITE DESCRIPTION: "Strategy Lab" on the features page
CURRENT LIMITATION: Only persisted experiments are shown. Never present an
  in-sample result as a profitable strategy.
FRONTEND TASK REQUIRED: None
```

### Data Coverage

```
FEATURE NAME: Data Coverage
BACKEND LOCATION: backend/wands/intelligence/freshness.py
API ENDPOINT: GET /v1/intelligence/coverage/public
DATA CONTRACT: ResearchCoverageDisclosure
MEMBER PAGE: /app/research
NAVIGATION LOCATION: MEMBER_NAV -> "Research"
PRODUCTION STATUS: local-verified
PUBLIC WEBSITE DESCRIPTION: not separately advertised
CURRENT LIMITATION: The operator projection (IntelCoverage) stays operator-only
FRONTEND TASK REQUIRED: None
```

### Member Watchlists, Saved Research, Alerts, Notifications

```
FEATURE NAME: Member Watchlists / Saved Research / Alerts / Notifications
BACKEND LOCATION: lib/member/{watchlists,saved,alerts,notifications}.ts
API ENDPOINT: /api/member/watchlists, /api/member/saved, /api/member/alerts, /api/member/notifications
DATA CONTRACT: member tables in db/
MEMBER PAGE: /app/watchlists, /app/saved, /app/alerts, /app/notifications
NAVIGATION LOCATION: MEMBER_NAV -> "Watchlists", "Saved", "Alerts", "Notifications"
PRODUCTION STATUS: local-verified
PUBLIC WEBSITE DESCRIPTION: membership benefits
CURRENT LIMITATION: None
FRONTEND TASK REQUIRED: None
```

### Opportunity Desk

```
FEATURE NAME: Opportunity Desk
BACKEND LOCATION: backend/wands/opportunity/
API ENDPOINT: /v1/opportunity/{budget,scan,candidates,decisions,tests}
DATA CONTRACT: lib/api/opportunity.ts
MEMBER PAGE: /app/opportunity
NAVIGATION LOCATION: MEMBER_NAV -> "Opportunity Desk" (founderOnly)
PRODUCTION STATUS: blocked
PUBLIC WEBSITE DESCRIPTION: internal, do not advertise
CURRENT LIMITATION: WANDS_FOUNDER_USER_IDS is unset, so the desk returns
  unconfigured and grants nobody.
FRONTEND TASK REQUIRED: None. This is an owner configuration step.
```

### Paper Trading, Portfolio and Risk, Automated Trading

```
FEATURE NAME: Paper Trading / Portfolio and Risk / Automated Trading
BACKEND LOCATION: backend/wands/{execution,brokers,portfolio,risk}/
API ENDPOINT: /v1/orders, /v1/bots, /v1/portfolio, /v1/risk
DATA CONTRACT: operator contracts in lib/api/contracts.ts
MEMBER PAGE: none
NAVIGATION LOCATION: operator console only
PRODUCTION STATUS: local-verified (operator)
PUBLIC WEBSITE DESCRIPTION: internal, do not advertise
CURRENT LIMITATION: Operator-only by design. Live trading is disabled
  (WANDS_TRADING_MODE=paper, WANDS_LIVE_TRADING_ENABLED=false).
FRONTEND TASK REQUIRED: None. Do not add these to member navigation.
```

---

## 7. Verification evidence

Run on 2026-08-11 against commit `2b412a5` plus this change.

| Check | Command | Result |
| --- | --- | --- |
| Backend suite | `python -m pytest -q` in `backend/` (Python 3.13, venv) | **657 passed** |
| Frontend suite | `pnpm exec vitest run` | **505 passed**, 40 files |
| Typecheck | `pnpm exec tsc --noEmit` | clean |
| Production build | `pnpm build` | exit 0; `/app/institutions` registered as a dynamic route |

Not run, and therefore not claimed:

- No engine was started, so `/healthz` and `/readyz` are unverified by execution.
- No production research request was made, so no member page was exercised
  against real data.
- No migration was applied to any database.
- No SEC ingestion was executed, so no filing counts are reported here.

---

## 8. Blockers requiring the owner

1. **Deploy the engine to Railway.** Configuration is prepared in
   `backend/railway.json` and `backend/.env.railway.example`; the runbook is
   `docs/railway-deployment.md`. This needs Railway access, which was not
   available when the configuration was written. No Railway build or deploy has
   been attempted, and no Railway Postgres should be added.
2. **Set `WANDS_ENGINE_URL` and `WANDS_RESEARCH_TOKEN`** on the frontend once the
   engine is reachable. Mint the token with
   `python -m scripts.create_research_key`. Until then every member research page
   renders `unavailable`, which is the correct behaviour, not a bug.
3. **Set `WANDS_ENCRYPTION_KEY`** on the engine before any broker credential is
   stored. The engine starts without it, but credential writes fail closed.
4. **Set `WANDS_FOUNDER_USER_IDS`** to make the Opportunity Desk operable.
5. **Isolate the application database** between development and production.
6. **Set `WANDS_SEC_USER_AGENT`** to a real operator contact before enabling SEC
   ingestion. The settings validator refuses to start on the placeholder.
