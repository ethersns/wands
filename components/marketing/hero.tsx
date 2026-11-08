import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "lucide-react";

import { Container } from "./container";
import { EditorialHeadline } from "./editorial";
import { Reveal } from "./reveal";
import { OverviewScreen } from "./terminal/screens";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        className="mk-grid mk-fade-b pointer-events-none absolute inset-0 opacity-50"
        aria-hidden
      />
      <div
        className="mk-vignette pointer-events-none absolute inset-0"
        aria-hidden
      />
      <div
        className="mk-grain pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
        aria-hidden
      />

      <Container width="wide" className="relative">
        <div className="pt-14 pb-10 sm:pt-20 lg:pt-24 lg:pb-12">
          <Reveal>
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-marketing-mono text-[9.5px] tracking-[0.22em] text-mk-dim uppercase">
              <span className="text-mk-accent">Wands</span>
              <span className="hidden text-mk-line-strong sm:inline" aria-hidden>
                /
              </span>
              <span>A different kind of market intelligence</span>
            </p>
          </Reveal>

          <Reveal variant="lines" delay={60}>
            <EditorialHeadline
              as="h1"
              className="mt-6 max-w-5xl text-[clamp(2.4rem,7vw,5.25rem)] leading-[0.9]"
              lines={[
                "THE MARKET MOVES.",
                "DO YOU KNOW WHAT'S",
                <span key="behind" className="text-mk-accent">
                  BEHIND IT?
                </span>,
              ]}
            />
          </Reveal>

          <Reveal delay={220}>
            <p className="mt-7 max-w-xl text-pretty text-[15px] leading-relaxed text-mk-muted sm:text-[16.5px]">
              Go beyond the price chart. Discover insider activity, institutional
              positioning and market research in one powerful workspace built for
              independent investors.
            </p>

            <div className="mt-8 flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <Link
                href="/#access"
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-mk-accent px-6 font-marketing-mono text-[11px] font-medium tracking-[0.14em] text-mk-accent-ink uppercase transition-colors hover:bg-mk-accent/90"
              >
                Get Early Access
                <ArrowUpRight
                  className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  aria-hidden
                />
              </Link>
              <Link
                href="/#intelligence"
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-full border border-mk-line-strong px-6 font-marketing-mono text-[11px] tracking-[0.14em] text-mk-fg uppercase transition-colors hover:border-mk-silver/40 hover:bg-mk-raised/60"
              >
                Explore Wands
                <ArrowDown
                  className="size-3.5 text-mk-dim transition-transform duration-200 group-hover:translate-y-0.5"
                  aria-hidden
                />
              </Link>
            </div>

            <p className="mt-5 font-marketing-mono text-[9.5px] tracking-[0.16em] text-mk-dim uppercase">
              Research tooling, not investment advice
            </p>
          </Reveal>
        </div>
      </Container>

      <Container width="wide" className="relative pb-14 sm:pb-20">
        <div id="platform" className="scroll-mt-20">
          <div className="mb-3 flex items-center justify-between gap-4 border-t border-mk-line pt-3">
            <span className="font-marketing-mono text-[9px] tracking-[0.18em] text-mk-dim uppercase">
              Source · SEC EDGAR
            </span>
            <span className="hidden font-marketing-mono text-[9px] tracking-[0.18em] text-mk-dim uppercase sm:block">
              Provenance retained
            </span>
            <span className="font-marketing-mono text-[9px] tracking-[0.18em] text-mk-dim uppercase">
              Freshness · 14m
            </span>
          </div>

          <div className="mk-stage relative">
            <div
              className="pointer-events-none absolute -inset-x-6 -top-6 bottom-0 rounded-2xl bg-[radial-gradient(70%_60%_at_50%_0%,rgba(200,247,81,0.1),transparent_70%)]"
              aria-hidden
            />
            <OverviewScreen className="relative mk-lime-glow" />
          </div>

          <p className="mt-4 text-center font-marketing-mono text-[9px] tracking-[0.14em] text-mk-dim uppercase">
            Illustrative interface · demonstration data, not live market data
          </p>
        </div>
      </Container>
    </section>
  );
}
