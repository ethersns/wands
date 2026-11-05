"use client";

import * as React from "react";

import { MarketTape } from "./market-tape";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EngineStatus, Envelope, MarketOverview } from "@/lib/api/contracts";

export function AppShell({
  engine,
  markets,
  children,
}: {
  engine: Envelope<EngineStatus>;
  markets: Envelope<MarketOverview>;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = React.useState(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-[13px] focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh border-r border-border lg:block">
        <Sidebar engine={engine} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <TopBar engine={engine} onOpenNav={() => setNavOpen(true)} />
        <MarketTape
          quotes={markets.data.quotes}
          provenance={markets.provenance}
        />
        <main
          id="main"
          className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-4 sm:px-5 sm:py-5 lg:px-7 lg:py-6"
        >
          {children}
        </main>
      </div>

      <Dialog open={navOpen} onOpenChange={setNavOpen}>
        <DialogContent className="top-0 left-0 h-dvh max-h-dvh w-[272px] max-w-[85vw] translate-x-0 translate-y-0 gap-0 rounded-none rounded-r-xl border-y-0 border-l-0 p-0">
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <DialogDescription className="sr-only">
            Primary sections of the Wands trading terminal.
          </DialogDescription>
          <Sidebar engine={engine} onNavigate={() => setNavOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
