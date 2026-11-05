# Wands Intelligence 1.0

A self-owned market-intelligence subsystem built on public SEC data. It collects
ownership filings and 13F holdings, stores them with provenance, derives research
signals from them, and serves the result over read-only authenticated endpoints.

It is not a copy of any commercial platform. No proprietary dataset, scoring
model or code from another product is used. Every measurement here is either
reported by the SEC or computed by us from what the SEC published, and every
figure can be traced back to the document that produced it.

## What this is, and what it is not

| It is | It is not |
| --- | --- |
| A record of what named people and institutions reported to the SEC | A claim about what they think, or will do |
| A set of measurements with stated windows and thresholds | A probability of profit |
| Read-only research data | A trade instruction, or a signal that can place an order |
| Honest about missing data | A feed that fills gaps with plausible numbers |

Three rules are enforced in code, not just documented:

1. **No fabrication.** A missing transaction price stays `null`. An empty feed
   returns `provenance: "unavailable"` with a reason, never a zero.
2. **No look-ahead.** A signal is invisible before the SEC acceptance time of the
   filing that produced it. Transaction dates are never used for availability.
3. **No execution path.** `wands/intelligence/` has no import of
   `wands.execution`, `wands.brokers` or `wands.risk`. A test asserts this.

## Architecture

```
wands/intelligence/
  base.py          contracts: errors, enums, parsed dataclasses
  retry.py         token bucket + bounded retry for public sources
  edgar.py         SEC EDGAR client (fair access, User-Agent, rate limit)
  forms.py         Form 3/4/5 and 13F information-table XML parsing
  classify.py      transaction classification (open market vs everything else)
  ingest.py        discovery, dedupe, persistence, run logging
  signals.py       insider signal engine
  institutions.py  13F holdings and quarter-over-quarter change
  fusion.py        explainable research ranking
  freshness.py     data freshness from the ingestion run log
  service.py       read-side queries for the API
  schemas.py       camelCase wire models
  cli.py           collection entry point
wands/api/routes/intelligence.py   read-only HTTP surface
```

Collection is a separate concern from serving. The API has no write verb, so no
HTTP request can make the engine fetch a URL or change stored research.

## Data model

| Table | Holds |
| --- | --- |
| `intel_filings` | One row per SEC accession: form type, issuer, symbol, period, acceptance time, source URL, amendment link, raw document hash |
| `intel_insider_transactions` | One row per reported line, per reporting person, with classification and reported value |
| `intel_institutions` | 13F filer identity |
| `intel_institutional_holdings` | One row per reported 13F position per quarter |
| `intel_signals` | Derived signals with their source event ids and availability time |
| `intel_ingest_runs` | Every collection attempt, used for freshness |

Migration: `9b4e2c7d1a05_intelligence_v1.py`. Additive only — no order, position,
risk or portfolio table is touched, and the downgrade drops exactly the six new
tables.

### Timestamps that must not be confused

| Field | Meaning |
| --- | --- |
| `transaction_date` | The day the insider traded. A fact about the past. |
| `period_of_report` | The quarter a 13F describes. Also the past. |
| `accepted_at` | When the SEC accepted the filing: when the world could read it. **The only timestamp a backtest may use.** |
| `ingested_at` | When Wands stored it. Operational, not analytical. |

When the SEC index omits a precise acceptance timestamp, the client falls back to
the *end* of the filing date. Midnight at the start of the day would let a
backtest see a filing up to a day before it existed.

## Transaction classification

Only code `P` on a non-derivative security, acquired, is an open-market purchase.
Only code `S`, disposed, is an open-market sale. Everything else is classified
and kept out of purchase aggregates:

| Code | Classification |
| --- | --- |
| `P` (non-derivative, acquired) | `open_market_purchase` |
| `S` (non-derivative, disposed) | `open_market_sale` |
| `A` | `award_grant` |
| `F` | `tax_withholding` |
| `G` | `gift` |
| `D` | `disposition_to_issuer` |
| `M`, `C`, `X`, `O`, `E`, `H` | `derivative_exercise` |
| `P` on a derivative table | `other` — a purchase of a different instrument |
| `P` with a disposition code | `other` — internally inconsistent |

A signal built on awards would look like insider confidence and mean nothing, so
this distinction is the core of the subsystem rather than a detail.

## Signals

| Category | Measurement | Fires when |
| --- | --- | --- |
| `INSIDER_PURCHASE_CLUSTER` | Distinct reporting persons with open-market purchases | `>= WANDS_INTELLIGENCE_CLUSTER_MIN_INSIDERS` in the window |
| `INSIDER_PURCHASE_VALUE` | Sum of reported purchase value | `>= WANDS_INTELLIGENCE_PURCHASE_VALUE_THRESHOLD_USD` |
| `INSIDER_ACTIVITY_CHANGE` | Current window value ÷ prior baseline window value | ratio `> 1` |
| `INSIDER_SELLING_CLUSTER` | Distinct reporting persons with open-market sales | `>= min_insiders`, with 10b5-1 caveats |
| `INSTITUTIONAL_POSITION_CHANGE` | Reported value change between two quarters | any change, with disclosure-delay caveats |

Every signal carries: unique id, symbol, source event ids, event time, public
availability time, calculation time, category, raw measurement and unit, a
normalised score, an explanation, a data-quality label, and confidence
limitations.

### The score

```
score = 100 × (1 − exp(−raw / threshold))
```

Monotonic, bounded to 0–100, and parameter-free. At the threshold it reads 63; at
twice the threshold, 86. It ranks signals against each other within a
deployment's own configuration. It is not a probability and the API says so in
every payload.

### Idempotency

`signal_key = sha256(category | symbol | sorted(source_event_ids))`. Recomputing
the same evidence is a no-op; a new filing produces a genuinely new signal. A
backtest cannot be inflated by re-running the engine.

### Amendments

An amendment is stored as its own filing with its own acceptance time and linked
to the original. For a given issuer, reporting person and period, only the most
recently accepted version available at the calculation time is used. Before the
amendment was accepted the original stands; after it, the amendment replaces it.
Counting both would double the reported activity.

## Institutional radar (13F)

Quarterly holdings, institution identity, reported position sizes, new and exited
positions, quarter-over-quarter change, disclosure dates and amendment handling.

Two honesty constraints are built in:

- A 13F is filed up to 45 days after the quarter ends. `period_of_report` is the
  quarter end; `accepted_at` is when it became readable. They are never
  interchanged.
- Reported values were in **thousands of dollars** until the amendments effective
  3 January 2023, and in **whole dollars** after. The parser normalises both to
  dollars, because mixing them would understate every pre-2023 position by 1000×.

A change between two snapshots is not evidence of a trade on any particular date,
and the API repeats that in every response.

## Signal fusion

`SignalFusion` combines independently calculated signals into one explainable
ranking. Weights are a stated editorial choice, not a fitted parameter:

| Component | Weight |
| --- | --- |
| `INSIDER_PURCHASE_CLUSTER` | 0.30 |
| `INSIDER_PURCHASE_VALUE` | 0.20 |
| `INSTITUTIONAL_POSITION_CHANGE` | 0.15 |
| `INSIDER_ACTIVITY_CHANGE` | 0.10 |
| `MARKET_TREND` | 0.10 |
| `VOLUME_ANOMALY` | 0.10 |
| `INSIDER_SELLING_CLUSTER` | 0.05 |

The composite is a weighted mean over the components that are actually present,
and `coverage` reports how much of the total weight that is. A symbol with one
component and a symbol with four are not presented as equally well-evidenced.

`MARKET_TREND` and `VOLUME_ANOMALY` read the Phase 3 candle store. Nothing here
re-implements market data.

The interface is designed so future modules can be added as components:
Crypto Whale Watch, Dark Pool Analytics, Options Flow Radar, Gamma Exposure,
CFTC Positioning. **None of those are implemented, and none is represented as
implemented.**

## Configuration

All settings are `WANDS_`-prefixed and declared once in `wands/config.py`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WANDS_INTELLIGENCE_ENABLED` | `true` | Master switch. When false, nothing is collected and the API says so. |
| `WANDS_INTELLIGENCE_INGEST_ENABLED` | `false` | Whether the scheduler collects automatically |
| `WANDS_INTELLIGENCE_INGEST_INTERVAL_SECONDS` | `3600` | Collection cadence; freshness is two missed cycles |
| `WANDS_SEC_USER_AGENT` | `wands-research/0.1 (research; contact: ops@example.com)` | **Required by the SEC.** Set this to a real contact before deploying. |
| `WANDS_SEC_BASE_URL` | `https://www.sec.gov` | Archives host |
| `WANDS_SEC_DATA_BASE_URL` | `https://data.sec.gov` | Submissions host |
| `WANDS_SEC_RATE_LIMIT_PER_SECOND` | `5.0` | Half the published ceiling |
| `WANDS_SEC_TIMEOUT_SECONDS` | `20.0` | Per-request timeout |
| `WANDS_SEC_MAX_RETRIES` | `3` | Transport failures and 429/5xx only |
| `WANDS_INTELLIGENCE_INSIDER_CIKS` | empty | Issuers to poll. Empty derives them from the equity watchlist. |
| `WANDS_INTELLIGENCE_INSIDER_LOOKBACK_DAYS` | `30` | Collection window |
| `WANDS_INTELLIGENCE_CLUSTER_MIN_INSIDERS` | `3` | Cluster threshold |
| `WANDS_INTELLIGENCE_CLUSTER_WINDOW_DAYS` | `30` | Cluster window |
| `WANDS_INTELLIGENCE_PURCHASE_VALUE_THRESHOLD_USD` | `250000` | Value threshold |
| `WANDS_INTELLIGENCE_ACTIVITY_BASELINE_DAYS` | `180` | Baseline window for activity change |
| `WANDS_INTELLIGENCE_SIGNAL_ENGINE_VERSION` | `1.0` | Stamped on every signal |

### SEC fair access

The client sends a descriptive `User-Agent` on every request and refuses to send
one without it. Requests pass through a token bucket set below the published
10-per-second ceiling. Only transport failures and explicit 429/503 responses are
retried; a malformed document is not, because the same request produces the same
bad answer. No HTML viewer is scraped and no access restriction is worked around.

## Running collection

Collection is a CLI or scheduler concern, never an HTTP endpoint.

```bash
# Collect ownership filings for the configured issuers
python -m wands.intelligence.cli ingest

# Collect for specific issuers
python -m wands.intelligence.cli ingest --ciks 0000320193 0000789019

# Recompute insider signals from what is already stored
python -m wands.intelligence.cli signals --symbols AAPL

# Collect 13F filings for specific institutions
python -m wands.intelligence.cli institutions --ciks 0001067983

# Report freshness
python -m wands.intelligence.cli status
```

`ingest` recomputes signals automatically when it stores new filings.

## API

All routes are under `/v1/intelligence`, require a bearer token with at least the
`viewer` role, and are read-only.

| Route | Returns |
| --- | --- |
| `GET /v1/intelligence/status` | Collection state, counts, freshness, caveats |
| `GET /v1/intelligence/insiders` | Paginated transaction feed |
| `GET /v1/intelligence/insiders/{symbol}` | Per-symbol insider summary |
| `GET /v1/intelligence/institutions` | 13F filers with their latest quarter |
| `GET /v1/intelligence/institutions/{cik}/changes` | Quarter-over-quarter holdings change |
| `GET /v1/intelligence/signals` | Paginated research signals |
| `GET /v1/intelligence/signals/{id}` | One signal with its full explanation |
| `GET /v1/intelligence/symbols/{symbol}/summary` | Insider summary + signals + fusion |

### Query parameters

`insiders`: `symbol`, `classification`, `open_market_only`, `since`, `page`,
`limit` (1–200).

`insiders/{symbol}`: `window_days` (1–730), `as_of`.

`signals`: `category`, `symbol`, `as_of`, `page`, `limit`.

`institutions`: `page`, `limit`.

`symbols/{symbol}/summary`: `as_of`.

`as_of` is the point-in-time control. Passing a past instant returns only what
was public at that moment, which is what a backtest must use.

### Envelopes

Every response uses the existing `Envelope<T>` contract:

```json
{
  "data": { "...": "..." },
  "provenance": "live",
  "generatedAt": "2026-11-05T14:00:00Z",
  "source": "wands-engine",
  "warnings": ["..."]
}
```

`provenance` is `unavailable` when nothing is stored for the query, with the
reason in `warnings`. Errors use the existing `{"error": {"code", "message"}}`
shape: `401 unauthorized`, `403 forbidden`, `404 not_found`, `422 bad_request`.

## Frontend integration

The TypeScript contracts are already in `lib/api/contracts.ts` and the fetchers in
`lib/api/endpoints.ts`. Nothing else is required to start building the page.

```ts
import {
  getIntelStatus,
  getInsiderFeed,
  getSignals,
  getSymbolResearch,
} from "@/lib/api/endpoints";

const status = await getIntelStatus();
const feed = await getInsiderFeed({ openMarketOnly: true, limit: 25 });
const signals = await getSignals({ category: "INSIDER_PURCHASE_CLUSTER" });
const summary = await getSymbolResearch("AAPL");
```

Each returns `Envelope<T>`. Research has **no demo fallback**: an unreachable
engine yields `provenance: "unavailable"` with an empty payload, because a
fabricated filing would be indistinguishable from a real one on screen.

### Rendering rules the UI must follow

1. **Show `provenance`.** An `unavailable` envelope renders an empty state with
   the warning text, never zeros.
2. **Show `dataQuality`.** `incomplete` means a required field was missing — for
   example a purchase with no reported price.
3. **Show `confidenceNotes`.** Every signal carries its own limitations. A score
   without them is a claim the engine does not make.
4. **Never label a signal a prediction.** The score is a research ranking.
5. **Distinguish the timestamps.** `eventTime` is when it happened;
   `publicAvailableAt` is when it became knowable. A chart axis uses the latter.
6. **Show `freshness`.** `stale` or `never` means the feed is not current, and the
   screen should say so rather than looking populated.
7. **Show the 13F caveat.** A quarterly snapshot is not a current position.

### Suggested page structure

- **Overview** — `getIntelStatus()` for freshness and coverage, then
  `getSignals()` for the signal feed.
- **Insider feed** — `getInsiderFeed()` with `openMarketOnly` and classification
  filters. Group by symbol; show `description` verbatim.
- **Clusters** — `getSignals({ category: "INSIDER_PURCHASE_CLUSTER" })`.
- **Institutions** — `getInstitutions()`, then `getInstitutionChanges(cik)`.
- **Symbol detail** — `getSymbolResearch(symbol)` for the combined view.
- **Source references** — every transaction and holding carries `sourceUrl`.
  Link to the SEC document rather than paraphrasing it.

## Testing

```bash
cd backend
python -m pytest tests/test_intelligence_*.py -q
```

120 deterministic tests, no network access:

| File | Covers |
| --- | --- |
| `test_intelligence_forms.py` | Parsing, classification of every code, amendments, missing prices, timestamps, 13F value units |
| `test_intelligence_ingest.py` | Dedupe, retries, source failures, fair access, acceptance-time fallback |
| `test_intelligence_signals.py` | Clustering, point-in-time boundaries, amendment supersession, scoring, idempotency |
| `test_intelligence_institutions.py` | 13F ingestion, reporting delay, quarter changes, amendment handling |
| `test_intelligence_fusion.py` | Composite ranking, coverage, market components, the research/execution import boundary |
| `test_intelligence_api.py` | Authentication, pagination, filters, empty states, read-only surface |

## Known gaps

Stated plainly, because a gap that is not written down becomes an assumption.

1. **CUSIP-to-symbol mapping is not implemented.** 13F holdings are keyed by
   CUSIP, so the institutional component is omitted from a symbol's fusion
   ranking unless a mapping is supplied. It is omitted, not approximated, and the
   response says so.
2. **Only `filings.recent` is read.** The SEC submissions JSON exposes older
   filings through paged archive files. A deployment polling a watchlist is
   unaffected; a full historical backfill is not implemented.
3. **No scheduler is wired into the app lifespan.** `WANDS_INTELLIGENCE_INGEST_ENABLED`
   exists but collection currently runs from the CLI or an external cron. This is
   deliberate for the first version: a background collector that starts itself is
   harder to reason about during an incident.
4. **No backtesting engine integration yet.** Signals are stored with
   `public_available_at` and the API accepts `as_of`, which is the contract a
   backtest needs. No performance result is claimed, because none has been
   measured.
5. **Form 3 holdings are stored as lines with an empty transaction code.** They
   are recorded, not treated as trades.
6. **Joint filings attribute the same transactions to each named owner.** That is
   what a joint filing means, but it means a cluster count of reporting persons is
   not guaranteed to be a count of independent decision-makers. The caveat is in
   every cluster signal.

## Recommended next milestone

**Intelligence 1.1 — measurement before expansion.**

1. Wire the scheduler into the app lifespan behind the existing flag, with a
   single-flight guard so two collectors cannot overlap.
2. Add a CUSIP-to-symbol mapping table, populated from issuer identity, so the
   institutional component can join a symbol's ranking.
3. Build the backtest adapter: forward returns after `public_available_at`,
   signal persistence, false-positive rate, benchmark comparison. Report measured
   results or report nothing.
4. Add archive paging for historical backfill.

Only after those are measured should new modules — options flow, dark pool, whale
watch — be considered. Adding modules before the existing ones are measured would
produce a wider surface with no more evidence behind it.
