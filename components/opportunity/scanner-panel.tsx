"use client";

import * as React from "react";
import useSWR from "swr";
import { Loader2, Pause, RefreshCw } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { advanceScannerAction, readScannerAction } from "@/lib/opportunity/scan-actions";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function ScannerPanel() {
  const [running, setRunning] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [confirmingRestart, setConfirmingRestart] = React.useState(false);
  const continuing = React.useRef(false);
  const { data: scan, error, isLoading, mutate } = useSWR(
    "opportunity-scan-status",
    readScannerAction,
    { refreshInterval: running ? 0 : 15_000, shouldRetryOnError: false },
  );

  React.useEffect(() => () => { continuing.current = false; }, []);

  async function run(startFresh = false) {
    continuing.current = true;
    setRunning(true);
    setProblem(null);
    setConfirmingRestart(false);
    try {
      let current = await readScannerAction();
      if (!continuing.current) return;
      if (startFresh) {
        if (!scan || !current || current.runId !== scan.runId || current.cursor !== scan.cursor) {
          await mutate(current, false);
          throw new Error("The saved scan changed since you confirmed. Review the latest checkpoint before replacing it.");
        }
        if (current.busy) throw new Error("Another scan batch is in progress. The saved checkpoint was not replaced.");
        const result = await advanceScannerAction({
          restart: true,
          replaceRunId: current.runId,
          replaceCursor: current.cursor,
        });
        if (!result.ok) throw new Error(result.message);
        if (!result.scan || result.scan.runId === current.runId) {
          await mutate(result.scan ?? current, false);
          throw new Error("Another worker kept the saved checkpoint. It was not replaced; resume or review the latest status.");
        }
        current = result.scan;
        await mutate(current, false);
      } else if (!current || current.status === "complete") {
        const result = await advanceScannerAction({ restart: current?.status === "complete" });
        if (!result.ok) throw new Error(result.message);
        current = result.scan ?? null;
        await mutate(current, false);
      }
      while (continuing.current && current?.status !== "complete") {
        const delay = Math.max(1000, new Date(current?.nextBatchAt ?? 0).getTime() - Date.now());
        await wait(Math.min(delay, 60_000));
        if (!continuing.current) break;
        const result = await advanceScannerAction(current ? {
          runId: current.runId, cursor: current.cursor, interval: current.interval,
        } : {});
        if (!result.ok) throw new Error(result.message);
        current = result.scan ?? null;
        await mutate(current, false);
        if (current?.lastError) {
          setProblem(`${current.lastError} Progress is saved. Resume after the provider backoff.`);
          break;
        }
      }
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Connection lost. Read saved status before resuming.");
      await mutate().catch(() => undefined);
    } finally {
      continuing.current = false;
      setRunning(false);
    }
  }

  const complete = scan?.status === "complete";
  const percent = scan?.total ? scan.checked / scan.total * 100 : 0;

  return (
    <SectionCard
      title="Opportunity scanner"
      description="Kraken USD spot discovery plus the existing stock watchlist. The breakout strategy and risk limits are unchanged."
      action={(
        <div className="flex flex-wrap gap-2">
          {running ? (
            <Button size="sm" variant="outline" onClick={() => { continuing.current = false; }}>
              <Pause data-icon="inline-start" aria-hidden /> Pause after batch
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => void run()} disabled={isLoading}>
                {isLoading ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden /> : <RefreshCw data-icon="inline-start" aria-hidden />}
                {scan && !complete ? "Resume scan" : "Find opportunities"}
              </Button>
              {scan && !complete ? (
                <Button size="sm" variant="ghost" onClick={() => setConfirmingRestart(true)} disabled={isLoading || scan.busy}>
                  Start new bounded scan
                </Button>
              ) : null}
            </>
          )}
        </div>
      )}
    >
      <div className="flex flex-col gap-4 text-sm text-muted-foreground">
        <p role="status" aria-live="polite">
          {running ? "Scanning in rate-limited batches" : complete ? "Scan complete" : scan ? "Saved scan — ready to resume" : "No scan started"}
          {scan ? ` · ${scan.checked} / ${scan.total ?? "discovering"} markets checked` : " · Discovery runs only when requested."}
        </p>
        <Progress value={percent} aria-label="Markets checked" />
        {confirmingRestart && scan && !complete ? (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-4">
            <p role="alert" className="text-sm text-foreground">
              This explicitly replaces checkpoint {scan.runId.slice(0, 8)} at {scan.checked}/{scan.total ?? "discovering"}. The new run uses the existing 40-USD-pair bound and unchanged safety filters. Previously stored candidates are retained; only the current resumable checkpoint is replaced. A run-id and cursor check prevents replacing a checkpoint that changed after this confirmation opened.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void run(true)} disabled={running}>Confirm new bounded scan</Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmingRestart(false)} disabled={running}>Keep saved scan</Button>
            </div>
          </div>
        ) : null}
        {scan?.replacedRun ? (
          <p className="text-xs text-muted-foreground">
            Previous checkpoint {scan.replacedRun.runId.slice(0, 8)} ({scan.replacedRun.status}, {scan.replacedRun.checked}/{scan.replacedRun.total ?? "unknown"} checked) was explicitly replaced. Stored candidate records remain in the desk.
          </p>
        ) : null}
        {scan ? (
          <>
            <dl className="flex flex-wrap gap-6">
              <div><dt>USD pairs checked</dt><dd className="font-mono text-foreground">{scan.pairsChecked}</dd></div>
              <div><dt>Active USD pairs discovered</dt><dd className="font-mono text-foreground">{scan.activeUsdPairs ?? "Unknown"}</dd></div>
              <div><dt>Qualifying setups</dt><dd className="font-mono text-foreground">{scan.qualified}</dd></div>
              <div><dt>Rejection reasons</dt><dd className="font-mono text-foreground">{scan.skipped.length}</dd></div>
            </dl>
            <p>
              Liquidity filter: at least ${Number(scan.liquidity.minUsdVolume24h).toLocaleString("en-US")} in rolling 24h USD turnover,
              spread no wider than {scan.liquidity.maxSpreadPct}%. Only online markets proceed. A qualifying pattern may still have infeasible sizing.
            </p>
            {scan.notes.map((note) => <p key={note}>{note}</p>)}
            <p>Each symbol is checked at its own observation time, not as one market-wide snapshot. Pause or leave this page and resume the saved scan later.</p>
            {scan.candidates.length ? (
              <details>
                <summary className="cursor-pointer text-foreground">Qualifying opportunities in this scan ({scan.candidates.length})</summary>
                <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto py-3">
                  {scan.candidates.map((candidate) => <li key={candidate.id} className="font-mono">{candidate.symbol} · {new Date(candidate.observedAt).toLocaleString("en-US")}</li>)}
                </ul>
                <p>Stored candidates below retain their original freshness and sizing warnings. No order is placed.</p>
              </details>
            ) : null}
            {scan.skipped.length ? (
              <details>
                <summary className="cursor-pointer text-foreground">Pairs checked and rejection reasons ({scan.skipped.length})</summary>
                <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto py-3">
                  {scan.skipped.map((item, index) => <li key={`${item.symbol}-${index}`}><span className="font-mono text-foreground">{item.symbol}</span>: {item.reason}</li>)}
                </ul>
              </details>
            ) : null}
            <p className="text-xs">Checkpoint: {new Date(scan.updatedAt).toLocaleString("en-US")} · {scan.interval} candles · research only, no automatic trading.</p>
          </>
        ) : null}
        {problem || error || scan?.lastError ? <p role="alert" className="text-loss">{problem ?? error?.message ?? scan?.lastError}</p> : null}
      </div>
    </SectionCard>
  );
}
