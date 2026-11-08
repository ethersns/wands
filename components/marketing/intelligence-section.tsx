import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Container } from "./container";
import { EditorialHeadline, SectionLabel } from "./editorial";
import { Reveal } from "./reveal";
import { InsiderScreen } from "./terminal/screens";

const proofPoints = [
  {
    title: "Insider Radar",
    body: "Form 4 transactions and insider clusters, organised by evidence rather than by hype.",
    href: "/features/insider-radar",
  },
  {
    title: "Institutional Radar",
    body: "13F holdings and reported position changes, with the disclosure lag stated plainly.",
    href: "/features/institutional-radar",
  },
  {
    title: "Source-backed",
    body: "Every figure keeps its filing, its date and its freshness. Nothing floats free of its evidence.",
    href: "/features",
  },
];

export function IntelligenceSection() {
  return (
    <section
      id="intelligence"
      className="relative scroll-mt-20 border-t border-mk-line py-16 sm:py-24"
    >
      <Container width="wide">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:gap-14">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <Reveal>
              <SectionLabel>Intelligence</SectionLabel>
            </Reveal>
            <Reveal variant="lines" delay={60}>
              <EditorialHeadline
                className="mt-5 text-[clamp(1.9rem,4.4vw,3.1rem)] leading-[0.94]"
                lines={[
                  "SEE WHAT THE",
                  "CHART DOESN'T",
                  <span key="tell" className="text-mk-accent">
                    TELL YOU.
                  </span>,
                ]}
              />
            </Reveal>
            <Reveal delay={140}>
              <p className="mt-6 max-w-md text-pretty text-[14px] leading-relaxed text-mk-muted">
                A price chart shows you the outcome. Wands shows you the
                disclosures moving around a company — insider transactions,
                institutional holdings, filing history — with the original
                evidence still attached to every number.
              </p>
            </Reveal>

            <Reveal delay={200}>
              <ul className="mt-8 flex flex-col">
                {proofPoints.map((point) => (
                  <li
                    key={point.title}
                    className="border-t border-mk-line py-4 first:border-t-0 first:pt-0"
                  >
                    <Link
                      href={point.href}
                      className="group flex items-start justify-between gap-4"
                    >
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[13px] font-medium text-mk-fg">
                          {point.title}
                        </span>
                        <span className="max-w-sm text-[12.5px] leading-relaxed text-mk-muted">
                          {point.body}
                        </span>
                      </div>
                      <ArrowRight
                        className="mt-1 size-3.5 shrink-0 text-mk-dim transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-mk-accent"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal delay={120} className="min-w-0">
            <div className="mb-2 flex flex-wrap justify-start gap-2 sm:justify-end">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-mk-accent/30 px-2.5 py-1">
                <span className="size-1 rounded-full bg-mk-accent" aria-hidden />
                <span className="font-marketing-mono text-[8.5px] tracking-[0.12em] text-mk-accent uppercase">
                  Score = evidence, not probability
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-mk-warn/30 px-2.5 py-1">
                <span className="size-1 rounded-full bg-mk-warn" aria-hidden />
                <span className="font-marketing-mono text-[8.5px] tracking-[0.12em] text-mk-warn uppercase">
                  13F disclosed up to 45 days late
                </span>
              </span>
            </div>
            <InsiderScreen />
            <p className="mt-3 font-marketing-mono text-[9px] tracking-[0.14em] text-mk-dim uppercase">
              Illustrative interface · demonstration data, not live market data
            </p>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
