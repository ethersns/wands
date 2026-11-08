import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Container } from "./container";
import { EditorialHeadline, SectionLabel } from "./editorial";
import { Reveal } from "./reveal";
import { PerformanceScreen } from "./terminal/screens";

const labPoints = [
  {
    title: "Reproducible experiments",
    body: "Define a hypothesis, run it across the stored history, and keep the result even when it disappoints.",
  },
  {
    title: "Costs before conclusions",
    body: "Commission and slippage are modelled before a result is allowed to look interesting.",
  },
  {
    title: "Benchmarks, not bragging",
    body: "A strategy is measured against a baseline, not against a screenshot.",
  },
  {
    title: "Honest gaps",
    body: "Coverage, freshness and missing evidence are reported next to the result. An empty result is a result.",
  },
];

export function ResearchSection() {
  return (
    <section
      id="research"
      className="relative scroll-mt-20 border-t border-mk-line bg-mk-deep/40 py-16 sm:py-24"
    >
      <Container width="wide">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.22fr)_minmax(0,0.78fr)] lg:gap-14">
          <Reveal delay={120} className="order-2 min-w-0 lg:order-1">
            <div className="mb-2 flex flex-wrap justify-start gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-mk-warn/30 bg-mk-warn/10 px-2.5 py-1">
                <span className="size-1 rounded-full bg-mk-warn" aria-hidden />
                <span className="font-marketing-mono text-[8.5px] tracking-[0.12em] text-mk-warn uppercase">
                  In development
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-mk-line-strong px-2.5 py-1">
                <span className="font-marketing-mono text-[8.5px] tracking-[0.12em] text-mk-dim uppercase">
                  No performance figures published
                </span>
              </span>
            </div>
            <PerformanceScreen />
            <p className="mt-3 font-marketing-mono text-[9px] tracking-[0.14em] text-mk-dim uppercase">
              Illustrative interface · demonstration data, not live market data
            </p>
          </Reveal>

          <div className="order-1 lg:order-2 lg:sticky lg:top-24 lg:self-start">
            <Reveal>
              <SectionLabel>Research</SectionLabel>
            </Reveal>
            <Reveal variant="lines" delay={60}>
              <EditorialHeadline
                className="mt-5 text-[clamp(1.9rem,4.4vw,3.1rem)] leading-[0.94]"
                lines={[
                  "DON'T JUST",
                  "FOLLOW A SIGNAL.",
                  <span key="q" className="text-mk-accent">
                    QUESTION IT.
                  </span>,
                ]}
              />
            </Reveal>
            <Reveal delay={140}>
              <p className="mt-6 max-w-md text-pretty text-[14px] leading-relaxed text-mk-muted">
                Quant Lab is where a hypothesis has to earn its place. Wands helps
                you investigate whether a market idea holds up against evidence —
                and tells you when it doesn&apos;t.
              </p>
            </Reveal>

            <Reveal delay={200}>
              <ul className="mt-8 flex flex-col">
                {labPoints.map((point) => (
                  <li
                    key={point.title}
                    className="border-t border-mk-line py-4 first:border-t-0 first:pt-0"
                  >
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[13px] font-medium text-mk-fg">
                        {point.title}
                      </span>
                      <span className="max-w-sm text-[12.5px] leading-relaxed text-mk-muted">
                        {point.body}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>

              <Link
                href="/features/strategy-lab"
                className="group mt-7 inline-flex items-center gap-1.5 font-marketing-mono text-[10px] tracking-[0.14em] text-mk-accent uppercase"
              >
                Explore Quant Lab
                <ArrowRight
                  className="size-3.5 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </Reveal>
          </div>
        </div>
      </Container>
    </section>
  );
}
