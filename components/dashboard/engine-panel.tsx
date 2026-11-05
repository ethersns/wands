import { Activity, Clock, Gauge, Lock, Server, TriangleAlert } from "lucide-react";

import { StatusChip } from "@/components/shared/status-chip";
import type { EngineStatus } from "@/lib/api/contracts";
import { formatDuration, formatRelative } from "@/lib/format";
import { engineStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-[11px] tabular text-foreground">{value}</span>
    </div>
  );
}

export function EnginePanel({ engine }: { engine: EngineStatus }) {
  const status = engineStatus(engine.state);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <StatusChip
          label={status.label}
          tone={status.tone}
          pulse={engine.state === "operational"}
        />
        <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
          v{engine.version}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <Metric icon={Clock} label="Uptime" value={formatDuration(engine.uptimeSeconds)} />
        <Metric
          icon={Activity}
          label="Market data latency"
          value={
            engine.marketDataLatencyMs === null
              ? "—"
              : `${engine.marketDataLatencyMs} ms`
          }
        />
        <Metric
          icon={Gauge}
          label="Stalest quote"
          value={
            engine.stalestQuoteAgeSeconds === null
              ? "—"
              : `${engine.stalestQuoteAgeSeconds}s`
          }
        />
        <Metric icon={Server} label="Active bots" value={String(engine.activeBots)} />
        <Metric icon={Server} label="Queued jobs" value={String(engine.queuedJobs)} />
      </div>

      <div
        className={cn(
          "flex items-start gap-2 rounded-md border px-2.5 py-2",
          engine.liveTradingEnabled
            ? "border-loss/30 bg-loss/[0.07]"
            : "border-border bg-muted/40",
        )}
      >
        <Lock
          className={cn(
            "mt-0.5 size-3 shrink-0",
            engine.liveTradingEnabled ? "text-loss" : "text-muted-foreground",
          )}
          aria-hidden
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {engine.liveTradingEnabled
            ? "Live order routing is authorised. Orders will reach a real venue."
            : "Live order routing is disabled at the engine. All execution is simulated."}
        </p>
      </div>

      {engine.notes.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {engine.notes.map((note) => (
            <li key={note} className="flex items-start gap-1.5">
              <TriangleAlert
                className="mt-0.5 size-3 shrink-0 text-muted-foreground/70"
                aria-hidden
              />
              <span className="text-[11px] leading-relaxed text-muted-foreground">
                {note}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="font-mono text-[10px] text-muted-foreground/70">
        heartbeat {formatRelative(engine.lastHeartbeat)} · {engine.region}
      </p>
    </div>
  );
}
