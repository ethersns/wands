"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";

import { navGroups } from "./nav-items";
import { ModeBadge } from "@/components/shared/mode-badge";
import type { EngineStatus, Envelope } from "@/lib/api/contracts";
import { engineStatus, toneDot, toneText } from "@/lib/status";
import { cn } from "@/lib/utils";

function BrandMark() {
  return (
    <span
      className="flex size-7 items-center justify-center rounded-md border border-border bg-elevated"
      aria-hidden
    >
      <svg viewBox="0 0 16 16" className="size-3.5" fill="none">
        <rect x="1" y="9" width="3" height="6" rx="1" fill="currentColor" opacity="0.45" />
        <rect x="6.5" y="5" width="3" height="10" rx="1" fill="currentColor" opacity="0.7" />
        <rect x="12" y="1" width="3" height="14" rx="1" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Sidebar({
  engine,
  onNavigate,
  className,
}: {
  engine: Envelope<EngineStatus>;
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const status = engineStatus(engine.data.state);

  return (
    <div className={cn("flex h-full flex-col bg-surface", className)}>
      <div className="flex items-center gap-2.5 px-4 py-4">
        <BrandMark />
        <div className="min-w-0">
          <p className="font-mono text-[13px] font-semibold tracking-[0.22em] text-foreground">
            WANDS
          </p>
          <p className="text-[10px] tracking-[0.04em] text-muted-foreground">
            Trading command centre
          </p>
        </div>
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-2 pb-4">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            <p className="px-2 pb-1.5 text-[10px] font-medium tracking-[0.14em] text-muted-foreground/70 uppercase">
              {group.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                        active
                          ? "bg-secondary font-medium text-foreground"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
                    >
                      <item.icon
                        className={cn(
                          "size-4 shrink-0",
                          active
                            ? "text-primary"
                            : "text-muted-foreground/80 group-hover:text-foreground",
                        )}
                        aria-hidden
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="rounded-lg border border-border bg-elevated/60 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  toneDot[status.tone],
                  engine.data.state === "operational" && "animate-pulse-dot",
                )}
                aria-hidden
              />
              <span className="text-[11px] font-medium text-foreground">
                Engine {status.label}
              </span>
            </span>
            <ModeBadge mode={engine.data.mode} />
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[10px] leading-relaxed text-muted-foreground">
            <Lock className="size-2.5 shrink-0" aria-hidden />
            {engine.data.liveTradingEnabled
              ? "Live routing authorised"
              : "Live trading disabled"}
          </p>
          <p
            className={cn(
              "mt-1 font-mono text-[10px] tracking-[0.04em]",
              engine.provenance === "live" ? toneText.profit : toneText.primary,
            )}
          >
            {engine.provenance === "live" ? "engine link" : "demo fixture"}
          </p>
        </div>
      </div>
    </div>
  );
}
