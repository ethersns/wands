# Feature inventory

The maintained record of what Wands actually implements, what a member can
actually reach, and what is still missing. Governed by **WANDS RULE 001** in
`AGENTS.md`.

Update this file in the same change that adds or alters a customer-facing
capability. A row that says `missing-frontend` is a defect, not a note.

- **Last verified:** 2026-11-09
- **Engine commit:** `480665a` (branch `main`)
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
| Institution holdings detail | `intelligence/institutions.py` | `GET /v1/intelligence/institutions/{cik}/changes` | `/app/institutions/[cik]` | via Institutions | `local-verified` |
| Research signals | `intelligence/signals.py`, `fusion.py` | `GET /v1/intelligence/signals`, `/signals/{id}` | `/app/signals`, `/app/signals/[id]` | Signals | `local-verified` |
| Signal validation | `intelligence/validation.py` | `GET /v1/intelligence/signals/{id}/validation` | `/app/signals/[id]` | via Signals | `local-verified` |
| Source provenance | `intelligence/member.py` | `GET /v1/intelligence/sources` | `/app/assets/[symbol]`, `/app/signals/[id]` | — | `local-verified` |
| Data coverage | `intelligence/freshness.py` | `GET /v1/intelligence/coverage/public` | `/app/research` | Research | `local-verified` |
| Founder Market Brief | `lib/member/brief.ts`, `lib/member/brief-model.ts` | composes `GET /v1/intelligence/{dashboard,coverage/public,catalysts,insiders,institutions,signals}` | `/app/research` | Research | `local-verified` |
| Quant Lab | `intelligence/quant.py`, `experiments.py`, `studies.py` | `POST /v1/intelligence/quant-lab/run`, `GET /experiments`, `/experiments/{id}` | `/app/quant-lab`, `/app/quant-lab/[id]` | Quant Lab | `local-verified` |
| Research Forensics | `intelligence/forensics.py` | `GET /v1/intelligence/experiments/{id}` (`forensics` block) | `/app/quant-lab/[id]` | via Quant Lab | `local-verified` |
| Catalyst Radar | `intelligence/catalysts.py`, `catalyst_sources.py` | `GET /v1/intelligence/catalysts` | `/app/catalysts` | Catalyst Radar | `local-verified` |
| Member watchlists | `lib/member/watchlists.ts` | `/api/member/watchlists` | `/app/watchlists` | Watchlists | `local-verified` |
| Saved research | `lib/member/saved.ts` | `/api/member/saved` | `/app/saved`, `/app/saved/[id]` | Saved | `local-verified` |
| Member alerts | `lib/member/alerts.ts` | `/api/member/alerts`, `/alerts/run` | `/app/alerts` | Alerts | `local-verified` |
| Notifications | `lib/member/notifications.ts` | `/api/member/notifications` | `/app/notifications` | Notifications | `local-verified` |
| Membership and billing | `lib/billing/` | `/api/billing/*` | `/app/membership` | Membership | `local-verified` |
| Account | `lib/member/account.ts` | `/api/member/account` | `/app/account` | Account | `local-verified` |
| Opportunity Desk | `backend/wands/opportunity/` | `/v1/opportunity/*` | `/app/opportunity` | Opportunity Desk (founder only) | `blocked` |

### Research read-path performance

The institutional feed and the dashboard were issuing one round-trip per filer
and recomputing every count twice. On a remote database each round-trip
dominates, so latency scaled with the number of filers rather than with the
amount of data. Measured statement counts for four filers with two quarters
each, before and after the batched read:

| Endpoint | Queries before | Queries after |
| --- | --- | --- |
| `GET /v1/intelligence/institutions` | 22 | 5 |
| `GET /v1/intelligence/dashboard` | 19 | 13 |
| `GET /v1/intelligence/coverage/public` | 8 | 8 |

`intel_institutional_holdings` had no index on `institution_id`, so each of
those reads was a sequential scan. Migration `b8d3f5a1c927` adds
`(institution_id, period_of_report)`. It is additive and reversible, and it has
**not** been applied to production — the rows above are statement counts, not
wall-clock timings, and the deployed latency is unverified until the migration
runs and the endpoints are re-timed from the Vercel runtime.

### Catalyst Radar

FEATURE NAME: Catalyst Radar
STATUS: `local-verified`

BACKEND IMPLEMENTATION:
`backend/wands/intelligence/catalysts.py` (contract, service, disclosure
queries) and `backend/wands/intelligence/catalyst_sources.py` (provider protocol,
FOMC calendar parser, TTL cache). No new table and no migration: scheduled events
are read from the source on demand and cached in process; disclosures are read
from the SEC rows the collectors already store.

API CONTRACT:
`GET /v1/intelligence/catalysts?category=&symbol=&window_days=&past_days=&limit=`
gated on `research:read`. Returns `CatalystFeed`: `items`, per-source `sources`
status, `windowStart`/`windowEnd`, `upcoming`/`recent` counts, `caveats`,
`coverageLimitations`. Each `Catalyst` carries five separate timestamps —
`occurredAt`, `scheduledDate`/`scheduledAt`, `publishedAt`, `collectedAt`,
`sourceUpdatedAt` — plus `timePrecision` (`exact`/`approximate`/`date_only`/
`unconfirmed`), `status`, `sourceName`, `sourceUrl`, `warnings`.

FRONTEND ROUTE AND NAVIGATION:
`app/app/catalysts/page.tsx`, composed from `components/member/catalyst-timeline.tsx`,
`catalyst-filters.tsx` and `catalyst-sources.tsx`. Navigation entry
`/app/catalysts` → "Catalyst Radar" in `components/member/member-shell.tsx`,
placed with the other discovery feeds between Signals and Quant Lab. Reads go
through `lib/member/research.ts` → `lib/api/research.ts`; the member surface
gained exactly one key (`catalysts`), which the member-surface test asserts.

PUBLIC WEBSITE LOCATION:
None. This is an authenticated research surface and is not described on the
marketing site. `components/marketing/next-chapter.tsx` names "Market Pulse" as a
future product; that is marketing copy, not this feature, and no claim about
Catalyst Radar is made there.

AVAILABLE PROVIDERS (verified by live request on 2026-11-09):

| Source | Reachable | Credential | Used |
| --- | --- | --- | --- |
| Federal Reserve FOMC calendar | HTTP 200 | none | **yes** |
| BLS release schedule | HTTP 403 (blocks automated clients) | none | no |
| FRED releases API | HTTP 400 without `api_key` | free key required | no |
| Earnings-calendar vendors | — | paid or keyed | no |

The FOMC page parsed to 56 meetings across 2021–2027 with **zero** mismatches
between the derived decision date and the Fed's own statement filename for every
meeting that has one. Out-of-cycle notation votes are excluded and the exclusion
is stated in the payload.

REAL VERSUS FIXTURE VERIFICATION:
The parser was exercised against the live page during development (56 events, 0
mismatches). The committed tests use a hand-built fixture and a fake HTTP client,
so they prove the parser refuses to invent a time — they do **not** prove the
live page still has this layout. No test reaches the network.

TEST COVERAGE:
`backend/tests/test_intelligence_catalysts.py` — 32 tests: confirmed event,
derived date-only event, cross-month range, footnote asterisk, notation-vote
exclusion, absolute source URL, empty page, disabled source, network failure,
HTTP error, cache TTL, no invented time, cancelled status passthrough, window
filtering, publication-vs-transaction time, collection lag, accession
deduplication, amendment flag, 13F period-end labelling, symbol filter,
category filter, spring and autumn DST boundaries, late-UTC previous-day
conversion, 401, 403, envelope shape, all-sources-failed, empty window.
`tests/member/catalyst-timeline.test.tsx` — 6 render tests, including that a
date-only event renders no clock time.

REMAINING BLOCKERS:
Earnings dates and non-FOMC macroeconomic releases are **not** collected. No
licensed, credential-free source exists for either, so the contract and the
truthful unavailable state are implemented and no calendar is manufactured. See
blocker 7.

### Opportunity Desk

Implemented end to end, but `WANDS_FOUNDER_USER_IDS` is unset, so
`requireFounder()` grants nobody and the desk returns `unconfigured`. This is
fail-closed by design. It becomes usable when the founder's Better Auth user id
is set in the Vercel Production environment.

### Founder Market Brief

FEATURE NAME: Founder Market Brief
STATUS: `local-verified`

BACKEND IMPLEMENTATION:
No new engine endpoint, no new table and no migration. `lib/member/brief-model.ts`
is a pure composition over feeds the engine already serves; `lib/member/brief.ts`
is the read layer. The brief adds no scoring, no collection, no inference and no
LLM call.

API CONTRACT:
Composes six existing customer-safe reads, issued in parallel:
`GET /v1/intelligence/dashboard`, `/coverage/public`, `/catalysts?window_days=30`,
`/insiders?limit=200`, `/institutions?page=1&limit=8`, `/signals?limit=200`.
No read is made per symbol, so the brief costs the same six requests for a
one-symbol watchlist and a fifty-symbol one. `tests/member/market-brief-read.test.ts`
asserts both the call count and the bounded limits.

READ COST (corrected):
The page performs **seven** reads, not eight. Six are engine requests; one is a
database read of the member's watchlists.

| Read | Before | After |
| --- | --- | --- |
| `GET /v1/intelligence/dashboard` | 1 | 1 |
| `GET /v1/intelligence/coverage/public` | 1 | 1 |
| `GET /v1/intelligence/catalysts` | 1 | 1 |
| `GET /v1/intelligence/insiders` | 1 | 1 |
| `GET /v1/intelligence/institutions` | 1 | 1 |
| `GET /v1/intelligence/signals` | 1 | 1 |
| `listTrackedSymbols(userId)` | 1 | — |
| `listWatchlists(userId)` (page) | 1 | — |
| `listWatchlists(userId)` (brief) | — | 1 |
| **Total** | **8** | **7** |

`listTrackedSymbols` and the page's `listWatchlists` read the same two tables
with the same `where w.user_id = $1` predicate. The brief now reads the
watchlists once and derives the distinct symbols with `trackedSymbolsFrom`, so
the page no longer reads them a second time. Authorization is unchanged: the
single read is still scoped to the signed-in member, and the brief reports
`watchlistCount` from that same result rather than from a second query.

COVERAGE LIMITATIONS (watchlist bias):
The engine serves the insider and signal feeds one page at a time and accepts a
single `symbol` filter, not a list. There is therefore no bounded way to request
"every record for these N watched symbols" in one call, and issuing one request
per symbol is explicitly out of scope. Two things follow:

1. The brief asks for the contract maximum of 200 rows per feed instead of 12,
   which is the most complete single bounded read the existing contract allows.
2. The brief reports the remainder. `insiderCoverage` and `signalCoverage` carry
   `retrieved` against the feed's own `total`, and when the page was partial the
   brief states it in "Known limitations", naming any watched symbol that has no
   record in the retrieved page and saying that its absence is not evidence of
   no activity.

Full watchlist coverage needs an engine extension: a repeated `symbols=` filter
(or equivalent) on `GET /v1/intelligence/insiders` and `/signals`, bounded to a
maximum symbol count and gated on the same `research:read` scope. That is
**not** implemented here — it is a backend contract change with its own tests,
and the brief states its partial coverage instead of implying completeness.

FRONTEND ROUTE AND NAVIGATION:
`app/app/research/page.tsx`, composed from `components/member/market-brief.tsx`.
The existing `/app/research` → "Research" navigation entry is reused. No new
route and no new nav item were added, so the brief is the research landing
surface rather than a second dashboard. Its sections summarize and link out to
`/app/catalysts`, `/app/insiders`, `/app/institutions`, `/app/signals` and the
asset pages.

PUBLIC WEBSITE LOCATION:
None. Authenticated research surface; no marketing claim is made about it.

SELECTION RULES (deterministic, and stated in the UI under "How these items were
selected"):

0. `time_unknown` — the brief could not establish when it was assessed, so no
   time-window rule was applied.
1. `watched_disclosure` — a watched symbol has an open-market insider filing
   published in the last 14 days.
2. `watched_catalyst` — a watched symbol is tagged to a scheduled event within
   30 days.
3. `market_catalyst` — a market-wide scheduled event within 7 days.
4. `watched_signal` — a watched symbol has a signal public in the last 14 days.
5. `source_stale` — a source is stale, failing or never collected, or published
   coverage is insufficient.

Ordering is rule, then publication time, then symbol, then id; the list is capped
at 8. No confidence percentage is computed, and no asset is ranked by an invented
score.

ASSESSMENT TIME (deterministic):
The brief is a pure function of its inputs. It previously read
`parseInstant(inputs.asOf) ?? Date.now()`, so a missing or malformed timestamp
silently made the assessment depend on the wall clock and the same inputs could
produce different briefs at different times. That fallback is gone.

`asOf` is now parsed once. When it yields no instant, `timeBasis` is
`indeterminate`, `asOf` and `context.asOf` are `null`, and rules 1-4 are not
applied at all: the brief does not claim that any disclosure, event or signal is
recent or upcoming, and `upcomingCatalysts`/`recentCatalysts` are empty rather
than classified against an invented "now". The state is stated in the UI as a
`time_unknown` investigation, a `time:unknown` limitation and a masthead badge.
A future timestamp is used as given, not clamped to the present.

DATA INTEGRITY:
Disclosure recency uses `acceptedAt` (publication), never `transactionDate`.
Date-only catalysts are compared as calendar days and render no clock time. 13F
holdings are labelled by `periodOfReport` and `publicAvailableAt` and are never
described as live buying or selling. Missing market-wide price data is stated as
a gap rather than shown as a flat market. An empty feed is reported as a
collection state, not as "no activity".

PROVENANCE ON PARTIAL FAILURE:
The brief previously collapsed six sources into one `unreachable` boolean, so a
single failed read was labelled "Engine unreachable" and a healthy brief was
labelled "Live data" with nothing in between. It now carries one
`BriefSourceStatus` per source and a derived `availability`:

| State | Meaning | Top-level label |
| --- | --- | --- |
| `healthy` | Read, and the source reports itself healthy | `complete` |
| `empty` | Read, and nothing is stored | `complete` |
| `stale` | Read, but the source reports ageing or failed collection | `partial` |
| `unavailable` | The engine could not be reached | `partial`, or `unavailable` when every source is down |

`unreachable` is now true only when every source is unreachable. The four states
are rendered separately in a "Source status" panel, and the per-source warnings
are still concatenated and deduplicated into the provenance note.

No missing value becomes an invented zero. When the dashboard could not be read,
`context.counts` is `null` and the market-context panel says so instead of
rendering four zeroes. The read layer also refuses the unreachable dashboard's
own payload timestamp, which is stamped with the current clock, so an outage
cannot masquerade as a valid assessment time.

TEST COVERAGE:
`tests/member/market-brief.test.ts` — 32 tests over deterministic fixtures:
complete brief, source attribution, empty-but-healthy, unreachable engine, stale
collection, missing market prices, date-only catalyst, disclosure availability
time, 13F delay, missing watchlist, non-open-market exclusion, deterministic
ordering, list cap, watchlist-first ordering, count passthrough, failed source,
cancelled/published exclusion; plus missing/malformed/future/valid assessment
time, identical output for identical indeterminate inputs, historical event
windows, a watched symbol outside the retrieved page, no partial-coverage claim
when the feed was complete, watchlist count, single-source partial failure,
all-sources-down, stale-as-partial, no invented zero count, and healthy-empty
versus unavailable.
`tests/member/market-brief-read.test.ts` — 11 tests: bounded reads, constant cost
for a large watchlist, per-member scoping, symbols derived from the single
watchlist read, member isolation across two members, bounded limits, per-source
unreachable reporting, no fabricated assessment time from an unreachable
dashboard, warning dedupe, exported-surface boundary, member research surface
boundary.
`tests/member/market-brief-view.test.tsx` — 12 render tests, including that a
date-only catalyst renders no clock time, that a null score renders "no research
ranking" rather than 0, that a single failed source renders "partial data", that
an indeterminate brief renders "no assessment time" instead of a quiet brief,
that no count is shown when the dashboard could not be read, and that an
unavailable source is distinguished from an empty one.

REAL VERSUS FIXTURE VERIFICATION:
Every test above uses hand-built fixtures. No test reaches the network and no
brief has been read against real engine data, because no engine is deployed. The
authenticated `/app/research` route was not exercised in a browser: it requires a
member session, and creating one would write to the production database. The view
is covered by the 12 render tests instead.

REMAINING BLOCKERS:
The brief is only as complete as the feeds behind it. Earnings and non-FOMC
macroeconomic calendars are still absent (blocker 7), so the brief states those
gaps on every load. Until `WANDS_ENGINE_URL` and `WANDS_RESEARCH_TOKEN` are set
(blocker 2), every section renders the truthful unavailable state.

Watchlist coverage is partial by contract, not by choice: the insider and signal
feeds accept one `symbol` and one page, so a watched symbol can sit outside the
200-row page the brief reads. The brief now says so and names the affected
symbols. Closing the gap needs a bounded multi-symbol filter on those two
endpoints, which is a backend contract change and is not part of this change.

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

**No scheduled-event surface existed at all.** `marketdata/calendar.py` is a
market *session* calendar: it answers "is the exchange open right now" and knows
nothing about events. There was no event calendar, no earnings source and no
economic-release source anywhere in the engine, and "Market Pulse" existed only
as a product name in `components/marketing/next-chapter.tsx` with no code behind
it. A member had no way to ask what was coming.

Added: `intelligence/catalysts.py` and `intelligence/catalyst_sources.py`,
`GET /v1/intelligence/catalysts`, `app/app/catalysts/page.tsx` with its three
components, and a `Catalyst Radar` entry in `MEMBER_NAV`.

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

**Institutional Radar had no drill-down.** The engine served
`GET /v1/intelligence/institutions/{cik}/changes`, but `lib/api/research.ts` had
no member-safe binding for it and no member page consumed it, so a member could
see a filer's reported value and position count and go no further. The signup
page promised "13F position changes" that the workspace could not show.

Added: `getInstitutionChanges` in `lib/api/research.ts` (re-exported as
`memberResearch.institutionChanges`), `institutionHref` in
`lib/member/links.ts`, `app/app/institutions/[cik]/page.tsx`,
`components/member/institution-holdings.tsx`, and a link from every
`InstitutionRow`.

**An exit was dated to the filing that still reported the position.** In
`InstitutionalRadar.changes`, an exited CUSIP took its `public_available_at` and
`source_url` from the prior quarter's row, because that was the only row that
existed for it. The prior filing reported the position as still held, so the
exit appeared to have become public up to a quarter before it could have been
observed, and its source link pointed at a document that contradicted the claim.
Both now come from the current quarter's filing, which is the document that
omits the CUSIP. Covered by
`test_an_exit_becomes_public_with_the_filing_that_omitted_it`.

### Open

| Gap | Detail | Status |
| --- | --- | --- |
| No single-institution summary endpoint | `GET /v1/intelligence/institutions/{cik}` does not exist. The detail page derives reported value, position count and public-availability time from the change set it already has, and labels them as sums of reported lines. A first-party summary would remove the derivation. | `partial` |
| No stored-quarter enumeration | `GET /v1/intelligence/institutions/{cik}/changes` accepts `period`, but nothing lists a filer's stored quarters. `periods` appears only on a feed row, inside a name-ordered paginated feed, so a period selector cannot be built without inventing the list. The detail page therefore shows the latest quarter only and passes `period` through when a link supplies it. | `partial` |
| No search, sort or filter on the institution feed | `GET /v1/intelligence/institutions` accepts only `page` and `limit`, and orders by name. The member list offers no search box, sort control or filter, because none would reach the engine. | `partial` |
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
API ENDPOINT: GET /v1/intelligence/institutions,
              GET /v1/intelligence/institutions/{cik}/changes
DATA CONTRACT: InstitutionFeed, Institution, InstitutionChanges,
               InstitutionalHoldingChange (lib/api/contracts.ts)
MEMBER PAGE: /app/institutions, /app/institutions/[cik]
NAVIGATION LOCATION: MEMBER_NAV -> "Institutions"; every feed row links to its
  detail page by CIK
PRODUCTION STATUS: local-verified
PUBLIC WEBSITE DESCRIPTION: "Institutional Radar and 13F position changes" (signup page)
CURRENT LIMITATION: The detail page shows the latest stored quarter only. The
  engine accepts a `period` parameter but exposes no list of a filer's stored
  quarters, so no period selector is offered. The feed has no search, sort or
  filter because the endpoint accepts only page and limit.
FRONTEND TASK REQUIRED: None. A period selector needs either
  GET /v1/intelligence/institutions/{cik} returning `periods`, or a `periods`
  field on InstitutionChanges.
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

### Research Forensics

```
FEATURE NAME: Research Forensics
BACKEND LOCATION: backend/wands/intelligence/forensics.py
API ENDPOINT: GET /v1/intelligence/experiments/{id} -> data.forensics
DATA CONTRACT: QuantForensics, QuantForensicFinding
MEMBER PAGE: /app/quant-lab/[id] -> "Research Forensics" panel
NAVIGATION LOCATION: none (reached through an experiment, not a destination)
PRODUCTION STATUS: local-verified
PUBLIC WEBSITE DESCRIPTION: not separately advertised
CURRENT LIMITATION: Twelve checks are assessed from the stored experiment and
  the stored daily series. A check is reported as verified only when the stored
  record contains the evidence that directly establishes the claim as stated. A
  property the record merely asserts — a held-out label, a pair of reproducibility
  hashes, a study that dates events by publication — is reported as declared, not
  verified, because nothing in the record corroborates it. Two checks can never
  pass on current data and are reported as unassessable rather than passed:
  parameter sensitivity (one parameter set is recorded, no sweep) and survivorship
  bias (the universe is a present-day list). Price coverage counts bars; it does
  not validate them. The temporal-boundary check verifies the two recorded dates,
  not the vintage of every underlying input. The report is computed on read and
  never stored, so it cannot rewrite what an old experiment claimed; it carries
  the assessment-rules version (currently 1.0.1) so a member can tell when the
  rules behind a status changed. It does not re-run a strategy and does not
  estimate a probability that a result is real.
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

Run on 2026-11-09 against commit `2b412a5` plus this change.

| Check | Command | Result |
| --- | --- | --- |
| Backend suite | `python -m pytest -q` in `backend/` (Python 3.13, venv) | **746 passed** |
| Frontend suite | `pnpm exec vitest run` | **551 passed**, 44 files |
| Typecheck | `pnpm exec tsc --noEmit` | clean |
| Lint | `pnpm exec eslint` on changed files | clean |
| Production build | `pnpm build` | exit 0; `/app/catalysts` registered as a dynamic route |

Not run, and therefore not claimed:

- No engine was started, so `/healthz` and `/readyz` are unverified by execution.
- `WANDS_ENGINE_URL` is unset in this environment, so `/app/catalysts` renders its
  unavailable state in preview rather than a populated feed. The populated state
  is covered by the backend contract tests and the timeline render tests, not by
  a browser session against a live engine.
- No production research request was made, so no member page was exercised
  against real data.
- No migration was applied to any database. Catalyst Radar adds no table.
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
7. **Decide the earnings and economic-release provider.** Catalyst Radar collects
   scheduled events from the Federal Reserve's FOMC calendar only, because it is
   the one official source that is both credential-free and machine-readable.
   Two categories are therefore absent, and the API says so rather than showing
   an empty calendar:
   - *Earnings announcement dates.* No credential-free, licensed source exists.
     SEC EDGAR publishes filings after the fact and does not publish scheduled
     earnings dates. A vendor (Alpha Vantage, Financial Modeling Prep, Polygon)
     requires a key and a licence review before redistribution to members.
   - *Non-FOMC macroeconomic releases* (CPI, employment, GDP). BLS returns HTTP
     403 to automated clients. FRED's `releases/dates` endpoint is the right
     source and needs a free `api_key`; it is a one-line addition to
     `catalyst_sources.py` once the key is issued.
   Until one of these is chosen, `WANDS_CATALYST_FOMC_ENABLED` governs the only
   scheduled source, and the coverage-limitations block on `/app/catalysts`
   states the gap to the member.
