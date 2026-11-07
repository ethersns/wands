import Link from "next/link";

import type { ResearchSignal, ResearchSignalCategory } from "@/lib/api/contracts";
import { Badge, formatDate } from "./ui";
import { SaveButton } from "./save-button";

const SIGNAL_LABEL: Record<ResearchSignalCategory, string> = {
  INSIDER_PURCHASE_CLUSTER: "Insider purchase cluster",
  INSIDER_PURCHASE_VALUE: "Insider purchase value",
  INSIDER_ACTIVITY_CHANGE: "Insider activity change",
  INSIDER_SELLING_CLUSTER: "Insider selling cluster",
  INSTITUTIONAL_POSITION_CHANGE: "Institutional position change",
  MARKET_TREND: "Market trend",
  VOLUME_ANOMALY: "Volume anomaly",
};

export function SignalRow({ signal }: { signal: ResearchSignal }) {
  return (
    <li className="flex flex-col gap-2 border-b border-mk-line px-4 py-3.5 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/app/assets/${encodeURIComponent(signal.symbol)}`}
            className="font-marketing-mono text-sm font-semibold text-mk-fg underline-offset-4 hover:text-mk-accent hover:underline"
          >
            {signal.symbol}
          </Link>
          <Badge tone="accent">{SIGNAL_LABEL[signal.category]}</Badge>
          {signal.dataQuality === "incomplete" || signal.dataQuality === "unavailable" ? (
            <Badge tone="warn">{signal.dataQuality}</Badge>
          ) : null}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-mk-fg text-pretty">{signal.explanation}</p>
        <p className="mt-1 font-marketing-mono text-[11px] text-mk-dim">
          {signal.score === null ? "no score" : `score ${signal.score}/100`}
          {" · "}
          {signal.rawMeasurement.toLocaleString()} {signal.rawUnit}
          {" · public "}
          {formatDate(signal.publicAvailableAt)}
        </p>
        {signal.confidenceNotes ? (
          <p className="mt-1 text-xs leading-relaxed text-mk-muted text-pretty">{signal.confidenceNotes}</p>
        ) : null}
      </div>
      <SaveButton
        kind="signal"
        refId={signal.id}
        symbol={signal.symbol}
        title={`${signal.symbol} — ${SIGNAL_LABEL[signal.category]}`}
        summary={signal.explanation}
        payload={{ category: signal.category, score: signal.score, engineVersion: signal.engineVersion }}
        className="shrink-0"
      />
    </li>
  );
}
