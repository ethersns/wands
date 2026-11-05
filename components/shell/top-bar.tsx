"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { navItemFor } from "./nav-items";
import { ThemeToggle } from "./theme-toggle";
import { EmergencyStop } from "./emergency-stop";
import { ModeBadge } from "@/components/shared/mode-badge";
import { Button } from "@/components/ui/button";
import type { EngineStatus, Envelope } from "@/lib/api/contracts";
import { engineStatus, toneDot } from "@/lib/status";
import { cn } from "@/lib/utils";

export function TopBar({
  engine,
  onOpenNav,
}: {
  engine: Envelope<EngineStatus>;
  onOpenNav: () => void;
}) {
  const pathname = usePathname();
  const item = navItemFor(pathname);
  const status = engineStatus(engine.data.state);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-3 backdrop-blur-md sm:px-5">
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        onClick={onOpenNav}
        aria-label="Open navigation"
      >
        <Menu className="size-4" aria-hidden />
      </Button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">
            {item?.label ?? "Wands"}
          </span>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            {item?.description}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span
          className="hidden items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 sm:inline-flex"
          title={`Engine ${status.label} · ${engine.data.region}`}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              toneDot[status.tone],
              engine.data.state === "operational" && "animate-pulse-dot",
            )}
            aria-hidden
          />
          <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
            {status.label}
          </span>
        </span>
        <ModeBadge mode={engine.data.mode} className="hidden sm:inline-flex" />
        <ThemeToggle />
        <EmergencyStop compact />
      </div>
    </header>
  );
}
