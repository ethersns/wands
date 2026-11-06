"use client";

import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { Container } from "./container";
import { EditorialHeadline, SectionLabel } from "./editorial";
import { Reveal } from "./reveal";
import { screens } from "./terminal/screens";

export function ProductStage() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const Active = screens[active].render as React.ComponentType<{
    className?: string;
  }>;

  function focusTab(index: number) {
    const next = (index + screens.length) % screens.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      focusTab(active + 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusTab(active - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusTab(screens.length - 1);
    }
  }

  return (
    <section
      id="platform"
      className="relative scroll-mt-20 border-t border-mk-line py-16 sm:py-24"
    >
      <Container width="wide">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <Reveal>
              <SectionLabel index="II">The reveal</SectionLabel>
            </Reveal>
            <Reveal variant="lines" delay={60}>
              <EditorialHeadline
                className="mt-5 max-w-3xl text-[clamp(2rem,4.6vw,3.5rem)] leading-[0.94]"
                lines={["MEET YOUR NEW", "RESEARCH ADVANTAGE."]}
              />
            </Reveal>
          </div>
          <Reveal delay={140}>
            <p className="max-w-sm text-pretty text-[14px] leading-relaxed text-mk-muted lg:pb-2">
              One place to discover market activity, investigate the evidence and
              explore what the data actually says.
            </p>
          </Reveal>
        </div>

        <div className="mt-10 grid gap-6 lg:mt-14 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
          <div
            role="tablist"
            aria-label="Product screens"
            aria-orientation="vertical"
            onKeyDown={onKeyDown}
            className="-mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-2 [mask-image:linear-gradient(to_right,#000_90%,transparent)] lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:pb-0 lg:[mask-image:none]"
          >
            {screens.map((screen, index) => {
              const selected = index === active;
              return (
                <button
                  key={screen.id}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`stage-tab-${screen.id}`}
                  aria-selected={selected}
                  aria-controls={`stage-panel-${screen.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActive(index)}
                  className={cn(
                    "group relative shrink-0 snap-start border text-left transition-colors lg:w-full lg:shrink",
                    "border-mk-line px-3.5 py-3 lg:border-0 lg:border-t lg:px-0 lg:py-4",
                    selected
                      ? "bg-mk-raised/70 lg:bg-transparent"
                      : "hover:bg-mk-raised/40 lg:hover:bg-transparent",
                  )}
                >
                  {selected ? (
                    <span
                      className="absolute top-0 left-0 hidden h-full w-px bg-mk-accent lg:block"
                      aria-hidden
                    />
                  ) : null}
                  <span className="flex items-baseline gap-2.5">
                    <span
                      className={cn(
                        "font-marketing-mono text-[9px] tracking-[0.14em] tabular-nums",
                        selected ? "text-mk-accent" : "text-mk-dim",
                      )}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={cn(
                        "font-marketing-mono text-[10.5px] tracking-[0.1em] whitespace-nowrap uppercase transition-colors",
                        selected
                          ? "text-mk-fg"
                          : "text-mk-muted group-hover:text-mk-fg",
                      )}
                    >
                      {screen.label}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "mt-1.5 hidden text-[12px] leading-relaxed lg:block",
                      selected ? "text-mk-silver" : "text-mk-dim",
                    )}
                  >
                    {screen.body}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`stage-panel-${screens[active].id}`}
            aria-labelledby={`stage-tab-${screens[active].id}`}
            tabIndex={0}
            className="min-w-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mk-accent"
          >
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h3 className="font-editorial text-[15px] font-semibold tracking-[-0.02em] text-mk-fg">
                {screens[active].headline}
              </h3>
              <span className="hidden font-marketing-mono text-[9px] tracking-[0.14em] text-mk-dim uppercase sm:block">
                {screens[active].label}
              </span>
            </div>

            <div
              key={screens[active].id}
              className="animate-[mk-rise_0.5s_cubic-bezier(0.16,1,0.3,1)]"
            >
              <Active />
            </div>

            <p className="mt-3 font-marketing-mono text-[9px] tracking-[0.14em] text-mk-dim uppercase">
              Illustrative interface · demonstration data
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}
