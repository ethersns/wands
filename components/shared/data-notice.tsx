import Link from "next/link";
import { ArrowRight, FlaskConical, Info } from "lucide-react";

import type { Envelope } from "@/lib/api/contracts";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Renders the provenance of a payload. Demonstration data is always announced
 * in the page body — never only in a tooltip — so no figure can be mistaken for
 * a real balance.
 */
export function DataNotice({
  envelope,
  className,
  compact = false,
}: {
  envelope: Pick<Envelope<unknown>, "provenance" | "warnings" | "source" | "generatedAt">;
  className?: string;
  compact?: boolean;
}) {
  if (envelope.provenance === "live") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-[11px] text-muted-foreground",
          className,
        )}
      >
        <span className="size-1.5 rounded-full bg-profit" aria-hidden />
        <span>
          Live from <span className="font-mono">{envelope.source}</span> ·{" "}
          {formatRelative(envelope.generatedAt)}
        </span>
      </div>
    );
  }

  const isDemo = envelope.provenance === "demo";

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3",
        isDemo
          ? "border-primary/25 bg-primary/[0.06]"
          : "border-border bg-muted/40",
        className,
      )}
    >
      <div
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md",
          isDemo ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        {isDemo ? (
          <FlaskConical className="size-3.5" aria-hidden />
        ) : (
          <Info className="size-3.5" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-foreground">
          {isDemo
            ? "Demonstration data — not a real account"
            : "Data unavailable"}
        </p>
        {!compact ? (
          <ul className="mt-1 space-y-0.5">
            {(envelope.warnings.length > 0
              ? envelope.warnings
              : [
                  "The trading engine has not returned this payload. Values shown are illustrative fixtures.",
                ]
            ).map((warning) => (
              <li
                key={warning}
                className="text-[11px] leading-relaxed text-muted-foreground"
              >
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Link
        href="/connections"
        className="inline-flex shrink-0 items-center gap-1 self-start rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
      >
        Connect engine
        <ArrowRight className="size-3" aria-hidden />
      </Link>
    </div>
  );
}
