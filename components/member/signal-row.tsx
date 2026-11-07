import Link from "next/link";

import type { ResearchSignal } from "@/lib/api/contracts";
import { SIGNAL_LABEL } from "@/lib/member/labels";
import { signalHref } from "@/lib/member/links";
import { Badge, formatDate } from "./ui";
import { SaveButton } from "./save-button";

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
        <Link
          href={signalHref(signal.id)}
          className="mt-1.5 inline-block text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
        >
          Open signal
        </Link>
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
