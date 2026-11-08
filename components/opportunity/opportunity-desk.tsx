"use client";

import * as React from "react";
import {
  CheckCircle2,
  Crosshair,
  Eye,
  FlaskConical,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import type {
  OpportunityCandidate,
  OpportunityDecision,
  OpportunityPaperTest,
} from "@/lib/api/opportunity";
import type { ActionOutcome } from "@/lib/intelligence/action-outcome";
import {
  evaluateTestAction,
  recordDecisionAction,
  recordTestAction,
  runScanAction,
} from "@/lib/opportunity/actions";
import { cn } from "@/lib/utils";

/**
 * The manual half of the Opportunity Desk.
 *
 * The page reads stored candidates, decisions and tests; this component is the
 * only place that writes. Every button reports the engine's own answer, so a
 * success is never shown before the server has confirmed it, and a failure is
 * never dressed up as a quiet no-op.
 */

const SETTLED = new Set(["test_completed", "test_invalidated", "test_expired"]);

const STATUS_LABEL: Record<string, string> = {
  test_active: "Active",
  test_completed: "Target reached",
  test_invalidated: "Invalidated",
  test_expired: "Expired at the time stop",
  entry_not_triggered: "Entry never triggered",
  insufficient_data: "Insufficient data",
};

function money(value: string | null, digits = 2): string {
  if (value === null) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return parsed.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function when(value: string): string {
  return new Date(value).toLocaleString("en-US");
}

function OutcomeBanner({ outcome }: { outcome: ActionOutcome | null }) {
  if (!outcome) return null;
  const Icon = outcome.ok ? CheckCircle2 : XCircle;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3",
        outcome.ok ? "border-profit/40 bg-profit/5" : "border-loss/40 bg-loss/5",
      )}
    >
      <Icon
        aria-hidden
        className={cn("mt-0.5 size-4 shrink-0", outcome.ok ? "text-profit" : "text-loss")}
      />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{outcome.title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-pretty text-muted-foreground">
          {outcome.message}
        </p>
        {outcome.detail.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {outcome.detail.map((line) => (
              <li key={line} className="font-mono text-[11px] text-muted-foreground">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function TestSummary({ test }: { test: OpportunityPaperTest }) {
  const settled = SETTLED.has(test.status);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground">
          <FlaskConical aria-hidden className="size-3.5 text-muted-foreground" />
          Paper test {STATUS_LABEL[test.status] ?? test.status}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          qty {money(test.quantity, 8)}
        </span>
        <span className="text-[11px] text-muted-foreground">
          opened {when(test.openedAt)}
        </span>
      </div>

      <p className="text-[12px] leading-relaxed text-muted-foreground">{test.exitReason}</p>

      {settled ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <div className="flex flex-col">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Entry</dt>
            <dd className="font-mono text-[12px] text-foreground">{money(test.entryPrice, 4)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Exit</dt>
            <dd className="font-mono text-[12px] text-foreground">{money(test.exitPrice, 4)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Net</dt>
            <dd
              className={cn(
                "font-mono text-[12px]",
                Number(test.netReturn) < 0 ? "text-loss" : "text-profit",
              )}
            >
              {money(test.netReturn)}
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Costs</dt>
            <dd className="font-mono text-[12px] text-foreground">
              {money(test.fees)} + {money(test.slippage)}
            </dd>
          </div>
        </dl>
      ) : null}

      {test.notes.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {test.notes.map((note) => (
            <li key={note} className="text-[11px] text-muted-foreground">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type Pending = "watch" | "reject" | "test" | "evaluate" | null;

function CandidateCard({
  candidate,
  decision,
  test,
  onOutcome,
}: {
  candidate: OpportunityCandidate;
  decision: OpportunityDecision | null;
  test: OpportunityPaperTest | null;
  onOutcome: (outcome: ActionOutcome) => void;
}) {
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState<Pending>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);

  const { sizing, dataQuality } = candidate;
  const busy = pending !== null;

  async function run(kind: Exclude<Pending, null>, action: () => Promise<ActionOutcome>) {
    setPending(kind);
    setLocalError(null);
    try {
      const result = await action();
      onOutcome(result);
      if (result.ok && (kind === "watch" || kind === "reject")) {
        setNote("");
      }
    } catch {
      setLocalError("The request did not reach the server. Nothing was recorded.");
    } finally {
      setPending(null);
    }
  }

  return (
    <article className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="font-mono text-base font-semibold text-foreground">
              {candidate.symbol}
            </h3>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {candidate.marketType}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{candidate.whyQualified}</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-sm text-foreground">
            {money(candidate.referencePrice, 4)}
          </div>
          <div className="text-xs text-muted-foreground">reference price</div>
        </div>
      </header>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Entry</dt>
          <dd className="text-sm text-foreground">{candidate.entryCondition}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Invalidation</dt>
          <dd className="text-sm text-foreground">{candidate.invalidationCondition}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Exit</dt>
          <dd className="text-sm text-foreground">{candidate.exitCondition}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>
          Strategy{" "}
          <span className="font-mono text-foreground">
            {candidate.strategyKey} v{candidate.strategyVersion}
          </span>
        </span>
        <span>
          Volume{" "}
          <span className="font-mono text-foreground">{candidate.volumeRatio.toFixed(2)}x</span>
        </span>
        <span>
          Costs{" "}
          <span className="font-mono text-foreground">
            {candidate.costs.feeBps}bps fee + {candidate.costs.slippageBps}bps slippage
          </span>
        </span>
        <span>
          Max hold <span className="font-mono text-foreground">{candidate.maxHoldingHours}h</span>
        </span>
      </div>

      <div className="rounded-md border border-border bg-muted/40 p-3">
        {sizing.feasible ? (
          <p className="text-sm text-foreground">
            Research size <span className="font-mono">{money(sizing.quantity, 8)}</span> units,{" "}
            <span className="font-mono">{money(sizing.notional)}</span> notional,{" "}
            <span className="font-mono">{money(sizing.riskAtStop)}</span> at the stop. Limited by{" "}
            {sizing.bindingConstraint}.
          </p>
        ) : (
          <p className="flex items-start gap-2 text-sm text-foreground">
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>Not testable at this size. {sizing.rejectedReason}</span>
          </p>
        )}
      </div>

      {dataQuality.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {dataQuality.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-muted-foreground">{candidate.rankReason}</p>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        {decision ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-muted/40 px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground">
              {decision.decision === "candidate_watched" ? (
                <Eye aria-hidden className="size-3.5 text-muted-foreground" />
              ) : (
                <XCircle aria-hidden className="size-3.5 text-muted-foreground" />
              )}
              {decision.decision === "candidate_watched" ? "Watched" : "Rejected"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              recorded {when(decision.decidedAt)}
            </span>
            {decision.note ? (
              <span className="text-[11px] text-muted-foreground">— {decision.note}</span>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Research note (optional)
              </span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={500}
                disabled={busy}
                placeholder="Why you are watching or rejecting this setup"
                className="w-full resize-y rounded-md border border-input bg-surface px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run("watch", () =>
                    recordDecisionAction(candidate.id, "candidate_watched", note),
                  )
                }
              >
                {pending === "watch" ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  <Eye className="size-3" aria-hidden />
                )}
                {pending === "watch" ? "Recording" : "Watch"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run("reject", () =>
                    recordDecisionAction(candidate.id, "candidate_rejected", note),
                  )
                }
              >
                {pending === "reject" ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  <XCircle className="size-3" aria-hidden />
                )}
                {pending === "reject" ? "Recording" : "Reject"}
              </Button>
            </div>
          </div>
        )}

        {test ? (
          <div className="flex flex-col gap-2">
            <TestSummary test={test} />
            {SETTLED.has(test.status) ? null : (
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => run("evaluate", () => evaluateTestAction(test.id))}
                >
                  {pending === "evaluate" ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw className="size-3" aria-hidden />
                  )}
                  {pending === "evaluate" ? "Evaluating" : "Evaluate against the candles since"}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || !sizing.feasible}
              onClick={() => run("test", () => recordTestAction(candidate.id))}
            >
              {pending === "test" ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <FlaskConical className="size-3" aria-hidden />
              )}
              {pending === "test" ? "Recording" : "Record hypothetical paper test"}
            </Button>
            {!sizing.feasible ? (
              <span className="text-[11px] text-muted-foreground">
                A test that could not have been opened is not evidence.
              </span>
            ) : null}
          </div>
        )}

        {localError ? (
          <p role="alert" className="text-[11px] text-loss">
            {localError}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export function OpportunityDesk({
  candidates,
  decisions,
  tests,
  candidatesError,
}: {
  candidates: OpportunityCandidate[];
  decisions: OpportunityDecision[];
  tests: OpportunityPaperTest[];
  candidatesError: string | null;
}) {
  const [outcome, setOutcome] = React.useState<ActionOutcome | null>(null);
  const [scanning, setScanning] = React.useState(false);

  const latestDecision = React.useMemo(() => {
    const map = new Map<string, OpportunityDecision>();
    for (const decision of decisions) {
      if (!map.has(decision.candidateId)) map.set(decision.candidateId, decision);
    }
    return map;
  }, [decisions]);

  const latestTest = React.useMemo(() => {
    const map = new Map<string, OpportunityPaperTest>();
    for (const test of tests) {
      if (!map.has(test.candidateId)) map.set(test.candidateId, test);
    }
    return map;
  }, [tests]);

  async function scan() {
    setScanning(true);
    try {
      setOutcome(await runScanAction());
    } catch {
      setOutcome({
        ok: false,
        title: "The scan did not run",
        message: "The request did not reach the server. Nothing was recorded.",
        detail: [],
        at: new Date().toISOString(),
      });
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <OutcomeBanner outcome={outcome} />

      <SectionCard
        title="Candidates"
        description="Stored candidates, newest first. A scan is an explicit action because it writes what it finds."
        action={
          <Button type="button" size="sm" variant="outline" onClick={scan} disabled={scanning}>
            {scanning ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3" aria-hidden />
            )}
            {scanning ? "Scanning" : "Run scan"}
          </Button>
        }
      >
        {candidatesError ? (
          <EmptyState
            icon={Crosshair}
            title="The engine could not be reached"
            description={candidatesError}
          />
        ) : candidates.length > 0 ? (
          <div className="flex flex-col gap-4">
            {candidates.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                decision={latestDecision.get(candidate.id) ?? null}
                test={latestTest.get(candidate.id) ?? null}
                onOutcome={setOutcome}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Crosshair}
            title="No candidates stored yet."
            description="Run a scan to apply the rule to the watchlist. A quiet scan is a normal result, not a failure."
          />
        )}
      </SectionCard>

      <SectionCard
        title="Journal"
        description="Every recorded test and decision, kept whether or not it worked out."
      >
        {tests.length === 0 && decisions.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            Nothing recorded yet. Watching, rejecting and recording a paper test all appear here.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {tests.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  Paper tests
                </h3>
                <ul className="flex flex-col divide-y divide-border">
                  {tests.map((test) => (
                    <li
                      key={test.id}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-[12px]"
                    >
                      <span className="font-mono text-foreground">{test.symbol}</span>
                      <span className="text-muted-foreground">
                        {STATUS_LABEL[test.status] ?? test.status}
                      </span>
                      <span className="text-muted-foreground">opened {when(test.openedAt)}</span>
                      {test.netReturn ? (
                        <span
                          className={cn(
                            "font-mono",
                            Number(test.netReturn) < 0 ? "text-loss" : "text-profit",
                          )}
                        >
                          net {money(test.netReturn)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {decisions.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  Decisions
                </h3>
                <ul className="flex flex-col divide-y divide-border">
                  {decisions.map((decision) => (
                    <li
                      key={decision.id}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-[12px]"
                    >
                      <span className="text-foreground">
                        {decision.decision === "candidate_watched" ? "Watched" : "Rejected"}
                      </span>
                      <span className="text-muted-foreground">{when(decision.decidedAt)}</span>
                      {decision.note ? (
                        <span className="text-muted-foreground">— {decision.note}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
