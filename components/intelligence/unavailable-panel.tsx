import Link from "next/link";
import { ArrowRight, CircleSlash, RefreshCw } from "lucide-react";

import type { Envelope } from "@/lib/api/contracts";
import { cn } from "@/lib/utils";

/**
 * The explicit unavailable state.
 *
 * Research has no demo fallback: a fabricated filing would be indistinguishable
 * from a real one on screen. When the engine does not answer, this renders the
 * engine's own reason and no figures at all.
 */
export function UnavailablePanel({
  envelope,
  title = "Research data unavailable",
  className,
  showConnect = true,
}: {
  envelope: Pick<Envelope<unknown>, "provenance" | "warnings" | "source">;
  title?: string;
  className?: string;
  showConnect?: boolean;
}) {
  if (envelope.provenance !== "unavailable") return null;

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-muted/30 px-4 py-4 sm:flex-row sm:items-start",
        className,
      )}
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground">
        <CircleSlash className="size-3.5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-foreground">{title}</p>
        <ul className="mt-1 flex flex-col gap-1">
          {(envelope.warnings.length > 0
            ? envelope.warnings
            : [
                "The engine returned no payload for this request. Nothing is shown rather than a placeholder figure.",
              ]
          ).map((warning) => (
            <li
              key={warning}
              className="text-[11px] leading-relaxed text-pretty text-muted-foreground"
            >
              {warning}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/70">
          source: {envelope.source}
        </p>
      </div>
      {showConnect ? (
        <Link
          href="/connections"
          className="inline-flex shrink-0 items-center gap-1 self-start rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <RefreshCw className="size-3" aria-hidden />
          Check engine
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}
