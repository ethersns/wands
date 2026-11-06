"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

import { Container } from "./container";
import { EditorialHeadline, SectionLabel } from "./editorial";
import { Reveal } from "./reveal";
import {
  InsiderScreen,
  InstitutionScreen,
  OverviewScreen,
} from "./terminal/screens";

const lenses = [
  {
    id: "insider",
    name: "Insider activity",
    blurb:
      "Open-market purchases and sales disclosed on Form 4, organised by cluster, seniority and size — with the filing date attached to every row.",
    caption: "Insider Radar · demonstration data",
    Screen: InsiderScreen,
  },
  {
    id: "institutional",
    name: "Institutional filings",
    blurb:
      "Quarterly 13F positions and the changes between them. The disclosure delay is shown next to the data, never hidden behind a live-looking feed.",
    caption: "Institutional Radar · demonstration data",
    Screen: InstitutionScreen,
  },
  {
    id: "signal",
    name: "Signal evidence",
    blurb:
      "The score, the components behind it and the records it was computed from. If the evidence is thin, the interface says so.",
    caption: "Intelligence Overview · demonstration data",
    Screen: OverviewScreen,
  },
];

export function LensSwitcher() {
  const [active, setActive] = useState(0);

  return (
    <section className="relative overflow-hidden border-t border-mk-line bg-mk-deep py-16 sm:py-24">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(50%_100%_at_50%_0%,rgba(200,247,81,0.07),transparent_70%)]"
        aria-hidden
      />

      <Container width="wide" className="relative">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Reveal>
              <SectionLabel>The wow moment</SectionLabel>
            </Reveal>
            <Reveal variant="lines" delay={60}>
              <EditorialHeadline
                className="mt-5 text-[clamp(2.4rem,7vw,5rem)] leading-[0.9]"
                lines={["GO DEEPER."]}
              />
            </Reveal>
          </div>
          <Reveal delay={140}>
            <p className="max-w-xs text-pretty text-[13.5px] leading-relaxed text-mk-muted sm:text-right">
              Three research lenses. Pick one and the workspace changes with it.
            </p>
          </Reveal>
        </div>

        <div className="mt-10 border-b border-mk-line">
          {lenses.map((lens, index) => {
            const open = index === active;
            const Screen = lens.Screen;
            return (
              <div key={lens.id} className="border-t border-mk-line">
                <h3>
                  <button
                    type="button"
                    onClick={() => setActive(index)}
                    aria-expanded={open}
                    aria-controls={`lens-panel-${lens.id}`}
                    className="group flex w-full items-center gap-4 py-5 text-left sm:gap-6 sm:py-6"
                  >
                    <span
                      className={cn(
                        "font-marketing-mono text-[9.5px] tracking-[0.16em] tabular-nums transition-colors",
                        open ? "text-mk-accent" : "text-mk-dim",
                      )}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={cn(
                        "font-editorial text-[clamp(1.4rem,4.2vw,2.6rem)] leading-none font-semibold tracking-[-0.04em] transition-colors",
                        open
                          ? "text-mk-fg"
                          : "text-mk-muted group-hover:text-mk-fg",
                      )}
                    >
                      {lens.name}
                    </span>
                    <span
                      className={cn(
                        "ml-auto flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                        open
                          ? "border-mk-accent/40 bg-mk-accent-soft text-mk-accent"
                          : "border-mk-line-strong text-mk-dim group-hover:text-mk-fg",
                      )}
                      aria-hidden
                    >
                      {open ? (
                        <Minus className="size-3.5" />
                      ) : (
                        <Plus className="size-3.5" />
                      )}
                    </span>
                  </button>
                </h3>

                <div
                  id={`lens-panel-${lens.id}`}
                  className={cn(
                    "grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
                    open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="overflow-hidden">
                    <div
                      className={cn(
                        "pb-8 transition-opacity duration-500",
                        open ? "opacity-100" : "opacity-0",
                      )}
                    >
                      <p className="max-w-2xl text-pretty text-[13.5px] leading-relaxed text-mk-muted">
                        {lens.blurb}
                      </p>
                      <div className="mt-5">
                        <Screen />
                      </div>
                      <p className="mt-3 font-marketing-mono text-[9px] tracking-[0.14em] text-mk-dim uppercase">
                        {lens.caption}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
