# Research API handoff — Intelligence Service 1.0

Typed contract between the Next.js member workspace and the private Python
research service.

- **Contract version:** `1.0.0` (`RESEARCH_CONTRACT_VERSION`)
- **Types:** `lib/api/research-contract.ts` — the single source of truth
- **Server access:** `lib/api/research.ts`
- **Transport:** `lib/api/client.ts` (`engineFetch`), server-only, bearer token
  from `WANDS_ENGINE_TOKEN`, base URL from `WANDS_ENGINE_URL`

The workspace reads research **only** through these endpoints. It never talks to
an exchange, a broker, or the SEC directly.

---

## 1. Rules the engine must hold

These are contract terms, not preferences. The workspace renders on the
assumption that they hold, and a violation shows up as a wrong claim on screen.

1. **Every response is an `Envelope<T>`** — `{ data, provenance, generatedAt,
   source, warnings }`. `provenance` is `live` only when the payload was read
   from stored research data during that request.
2. **Research has no `demo` provenance.** A fabricated filing is
   indistinguishable from a real one on screen. When the engine cannot answer,
   return `provenance: "unavailable"` with an empty payload and a stated reason
   in `warnings`. The workspace renders that state and no figures.
3. **A missing value is `null` with a reason.** Never `0`, never `""`, never a
   placeholder. "No purchase reported a price" and "the purchase was worth
   nothing" are different claims.
4. **Two timestamps are never conflated.** `eventTime` is when the activity
   happened; `publicAvailableAt` is when it became knowable. Only the second may
   date a backtest or a performance claim.
5. **A research score is a bounded 0-100 ranking of evidence.** Not a
   probability, not an expected return, not a recommendation. `null` when there
   is not enough evidence — never `0`.
6. **Every claim carries a source link**, or an explicit statement that the
   source could not be resolved. A claim with no link is not shown as verified.
7. **Collection machinery stays behind the operator surface.** Jobs, leases,
   backfill cursors, retry counters, identifier-resolution internals and raw
   upstream error strings are not part of this contract.

---

## 2. Endpoints

`status` is what the endpoint needs from the engine team.

| Name | Method | Path | Status |
| --- | --- | --- | --- |
| `dashboard` | GET | `/v1/intelligence/dashboard` | **new** |
| `asset` | GET | `/v1/intelligence/symbols/{symbol}/summary` | **extend** |
| `insiders` | GET | `/v1/intelligence/insiders` | existing |
| `insiderSummary` | GET | `/v1/intelligence/insiders/{symbol}` | existing |
| `insiderTransaction` | GET | `/v1/intelligence/insiders/transactions/{id}` | **new** |
| `institutions` | GET | `/v1/intelligence/institutions` | existing |
| `institutionChanges` | GET | `/v1/intelligence/institutions/{cik}/changes` | existing |
| `signals` | GET | `/v1/intelligence/signals` | existing |
| `sources` | GET | `/v1/intelligence/sources` | **new** |
| `coverage` | GET | `/v1/intelligence/coverage/public` | **new** |

The machine-readable version of this table, including the fields each response
must omit, is `RESEARCH_ENDPOINTS` in `lib/api/research-contract.ts`. Keep the
two in step.

### 2.1 `GET /v1/intelligence/dashboard` — new

Response: `ResearchDashboard`.

```ts
{
  asOf: string;
  freshness: "fresh" | "stale" | "never" | "failing";
  counts: {
    filings: number; transactions: number; signals: number;
    institutions: number; holdings: number; symbols: number;
  };
  latestFilingAt: string | null;
  latestSignalAt: string | null;
  topSignals: ResearchSignal[];        // bounded, e.g. 10
  recentPurchases: InsiderTransaction[]; // open-market purchases only
  coverage: ResearchCoverageDisclosure;
  caveats: string[];
}
```

Counts are of **stored records**, not of events that happened. The workspace
labels them that way; do not send a count you cannot derive from stored rows.

### 2.2 `GET /v1/intelligence/symbols/{symbol}/summary` — extend

Response: `AssetResearch`. The endpoint already serves `symbol`, `asOf`,
`insider`, `signals`, `fusion`, `freshness`, `caveats`. It must gain:

- `issuerName: string | null`
- `sources: ResearchSourceLink[]` — the evidence chain for this asset
- `coverage: ResearchCoverageDisclosure` — scoped to this symbol

`symbol` is upper-cased and URL-encoded by the workspace. An unknown symbol is a
`200` with empty `signals`, `sources` and a `coverage.status` of `unavailable`
or `insufficient` — **not** a `404`. The page distinguishes "nothing stored" from
"engine unreachable" using `provenance`, so a `404` would collapse the two.

### 2.3 `GET /v1/intelligence/sources` — new

Query: `subject_type` (`symbol` | `insider_transaction` | `institution` |
`signal`), `subject_id`, optional `symbol`.

Response: `ResearchSourceLink[]`.

```ts
{
  id: string;
  kind: "sec_filing" | "sec_filing_index" | "issuer_release" | "price_series";
  label: string;                 // "Form 4 — Acme Corp (2026-03-14)"
  url: string;                   // absolute https, never relative
  accessionNumber: string | null;
  formType: string | null;
  publicAvailableAt: string | null;
  supports: string;              // the claim this link backs
  retrievedAt: string;
}
```

`url` must be absolute. The workspace renders it as an external link and does
not rewrite it.

### 2.4 `GET /v1/intelligence/coverage/public` — new

Response: `ResearchCoverageDisclosure`.

```ts
{
  status: "complete" | "partial" | "insufficient" | "unavailable";
  windowStart: string | null;
  windowEnd: string | null;
  symbolsCovered: number;
  symbolsRequested: number;
  gaps: { key: string; label: string; detail: string }[];
  caveats: string[];
}
```

This is the customer projection of `IntelCoverage`. It must **not** include
`identifiers`, `backfill`, `priceCoverage` or `jobs`. `insufficient` is distinct
from `partial`: partial means some of the window is covered, insufficient means
what is stored cannot support the claim being made. Both are shown to the member.

### 2.5 `GET /v1/intelligence/insiders/transactions/{id}` — new

Response: `InsiderTransaction`.

A filing is addressed by its own stable id, not by its position in a feed. The
member workspace links to a filing from a saved record, a signal's evidence and
an asset page, and those links must keep working after the filing has aged out
of the published window.

- An unknown id is a `404`. The page distinguishes "the engine has no such
  filing" from "the engine is unreachable" using `provenance`, so the two must
  not collapse into the same response.
- Until this route is served, the workspace falls back to scanning the published
  feed and says so in `warnings`. That fallback is a stopgap: a filing older than
  the feed window cannot be opened by id, which is the defect this endpoint
  removes.

---

## 3. What the workspace already renders

So you can see what a shape change breaks:

| Surface | Route | Consumes |
| --- | --- | --- |
| Asset research index | `/intelligence/symbols` | `insiderSummary`-adjacent status, `coverage` |
| Asset research | `/intelligence/symbols/[symbol]` | `asset` |
| Intelligence overview | `/intelligence` | `insiders`, `institutions`, `signals`, status |
| Insider Radar | `/intelligence/insiders` | `insiders`, `insiderSummary` |
| Institutional Radar | `/intelligence/institutions` | `institutions`, `institutionChanges` |
| Performance | `/intelligence/performance` | experiments, validation |
| Data Coverage | `/intelligence/coverage` | `IntelCoverage` (operator) |
| Operations | `/intelligence/operations` | jobs, backfill (operator) |

The last two are the **operator** surface and are not part of this contract. They
may keep reading the internal shapes.

`lib/api/research.ts` defaults every field of `AssetResearch` before rendering,
so a response that omits `sources`, `coverage` or `issuerName` still renders —
it shows the empty state rather than crashing. That is a safety net, not a
licence to omit them: an asset page with no coverage disclosure is not
publishable.

---

## 4. Acceptance checks

For each endpoint, the engine team should be able to show:

1. A response with `provenance: "live"` and a non-empty payload.
2. A response with `provenance: "unavailable"`, an empty payload, and a reason
   in `warnings` — with the workspace rendering no figures.
3. A record whose price was not reported, returning `null` and not `0`.
4. A signal whose `publicAvailableAt` is later than its `eventTime`, and a
   backtest that refuses to use it before `publicAvailableAt`.
5. A claim with a resolvable source link, and one with an unresolvable source
   that is labelled as such rather than dropped silently.
6. A coverage response with `status: "insufficient"` and at least one `gap`.
7. No response in this contract containing `leaseOwner`, `lastError`,
   `consecutiveFailures`, `cursor`, `attempts`, `identifiers`, `backfill` or
   `priceCoverage`.

---

## 5. Out of scope

Not part of this contract, and not to be added to it:

- Collection operations, backfill controls, job pause/resume.
- Internal diagnostics: leases, retry counters, parser warnings, raw documents.
- Any endpoint that can place an order, reach a broker, change a risk limit or
  enable live trading. Research is read-only by construction.
- Any automatic routing of a signal to a bot.
