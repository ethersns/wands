import Link from "next/link";
import { ArrowRight, CircleCheck, TriangleAlert } from "lucide-react";

import type { RiskSnapshot } from "@/lib/api/contracts";
import { severityTone, toneText } from "@/lib/status";
import { cn } from "@/lib/utils";

export function RiskWarnings({ risk }: { risk: RiskSnapshot }) {
  if (risk.breaches.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-profit/25 bg-profit/[0.06] px-2.5 py-2">
        <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-profit" aria-hidden />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          No risk limits are currently breached. All monitored constraints are
          within policy.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {risk.breaches.map((breach) => {
        const tone = severityTone(breach.severity);
        return (
          <li
            key={breach.key}
            className={cn(
              "flex items-start gap-2 rounded-md border px-2.5 py-2",
              tone === "loss"
                ? "border-loss/30 bg-loss/[0.07]"
                : "border-primary/25 bg-primary/[0.06]",
            )}
          >
            <TriangleAlert
              className={cn("mt-0.5 size-3.5 shrink-0", toneText[tone])}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-foreground">
                {breach.label}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {breach.detail}
              </p>
            </div>
          </li>
        );
      })}
      <li>
        <Link
          href="/risk"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary transition-opacity hover:opacity-80"
        >
          Open Risk Centre
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </li>
    </ul>
  );
}
