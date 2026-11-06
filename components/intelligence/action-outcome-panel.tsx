import { CircleCheck, CircleSlash } from "lucide-react";

import type { ActionOutcome } from "@/lib/intelligence/action-outcome";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The engine's own answer, rendered verbatim.
 *
 * `ok` comes from the engine's response, never from the fact that a request was
 * sent, so a refused action can never be shown as a success.
 */
export function ActionOutcomePanel({
  outcome,
  className,
}: {
  outcome: ActionOutcome;
  className?: string;
}) {
  const Icon = outcome.ok ? CircleCheck : CircleSlash;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5",
        outcome.ok
          ? "border-profit/30 bg-profit/[0.07]"
          : "border-loss/30 bg-loss/[0.07]",
        className,
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          outcome.ok ? "text-profit" : "text-loss",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-foreground">{outcome.title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-pretty text-muted-foreground">
          {outcome.message}
        </p>
        {outcome.detail.length > 0 ? (
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {outcome.detail.map((line) => (
              <li key={line} className="font-mono text-[10px] text-muted-foreground">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
          engine response at {formatDateTime(outcome.at)}
        </p>
      </div>
    </div>
  );
}
