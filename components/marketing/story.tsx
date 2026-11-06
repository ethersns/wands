import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { Container } from "./container";
import { EditorialHeadline, MarginNote, SectionLabel } from "./editorial";
import { Reveal } from "./reveal";
import {
  InsiderScreen,
  InstitutionScreen,
  PerformanceScreen,
} from "./terminal/screens";

const layers = [
  { source: "Form 4", detail: "NVDA · director purchase", tone: "accent" },
  { source: "13F", detail: "Q3 2026 · position change", tone: "emerald" },
  { source: "OHLCV", detail: "1m bars · 1,842 symbols", tone: "silver" },
  { source: "Form 4", detail: "MSFT · CFO purchase", tone: "accent" },
  { source: "13F", detail: "Q3 2026 · new position", tone: "emerald" },
  { source: "Provenance", detail: "filing date retained", tone: "silver" },
  { source: "Form 4", detail: "ASML · director purchase", tone: "accent" },
  { source: "13F", detail: "Q3 2026 · position trimmed", tone: "emerald" },
  { source: "Corporate", detail: "split · 4:1 · adjusted", tone: "silver" },
  { source: "Form 4", detail: "COST · EVP purchase", tone: "accent" },
];

export function ActProblem() {
  return (
    <section className="relative overflow-hidden border-t border-mk-line py-16 sm:py-24">
      <Container width="wide">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
          <div>
            <Reveal>
              <SectionLabel index="I">The problem</SectionLabel>
            </Reveal>
            <Reveal variant="lines" delay={60}>
              <EditorialHeadline
                className="mt-5 text-[clamp(1.9rem,4.8vw,3.5rem)] leading-[0.94]"
                lines={[
                  "PRICE IS WHAT YOU SEE.",
                  <span key="c" className="text-mk-muted">
                    CONTEXT IS WHAT
                  </span>,
                  <span key="m" className="text-mk-muted">
                    YOU&apos;RE MISSING.
                  </span>,
                ]}
              />
            </Reveal>
            <Reveal delay={140}>
              <p className="mt-6 max-w-md text-pretty text-[14px] leading-relaxed text-mk-muted">
                Markets generate more information than any one person can follow.
                Insider disclosures. Institutional filings. Changes in
                positioning. Signals buried across disconnected sources.
              </p>
            </Reveal>
          </div>

          <Reveal delay={200}>
            <div className="relative h-[19rem] overflow-hidden rounded-lg border border-mk-line bg-mk-surface/50">
              <div
                className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-b from-mk-bg via-transparent to-mk-bg"
                aria-hidden
              />
              <div className="absolute inset-0 overflow-hidden">
                <div className="mk-stream flex flex-col gap-2 px-4 pt-4">
                  {[...layers, ...layers].map((layer, index) => (
                    <div
                      key={`${layer.source}-${index}`}
                      className="flex items-center gap-3 border border-mk-line bg-mk-deep/70 px-3 py-2"
                    >
                      <span
                        className={cn(
                          "size-1 shrink-0 rounded-full",
                          layer.tone === "accent" && "bg-mk-accent",
                          layer.tone === "emerald" && "bg-mk-emerald",
                          layer.tone === "silver" && "bg-mk-silver/60",
                        )}
                        aria-hidden
                      />
                      <span className="w-16 shrink-0 font-marketing-mono text-[8.5px] tracking-[0.14em] text-mk-dim uppercase">
                        {layer.source}
                      </span>
                      <span className="truncate font-marketing-mono text-[9.5px] text-mk-muted">
                        {layer.detail}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="absolute bottom-3 left-4 z-20 font-marketing-mono text-[8.5px] tracking-[0.16em] text-mk-dim uppercase">
                Disconnected sources
              </p>
            </div>
          </Reveal>
        </div>

        <Reveal delay={120} className="mt-14 sm:mt-20">
          <div className="border-t border-mk-line pt-10">
            <p className="mx-auto max-w-3xl text-center font-editorial text-[clamp(1.4rem,3.6vw,2.5rem)] leading-[1.1] font-medium tracking-[-0.035em] text-balance text-mk-fg">
              What if the important pieces were finally{" "}
              <span className="relative whitespace-nowrap text-mk-accent">
                in one place
                <span
                  className="absolute -bottom-1 left-0 h-px w-full bg-mk-accent/50"
                  aria-hidden
                />
              </span>
              ?
            </p>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

export function ActInsider() {
  return (
    <section
      id="intelligence"
      className="relative scroll-mt-20 border-t border-mk-line py-16 sm:py-24"
    >
      <Container width="wide">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-12">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <Reveal>
              <SectionLabel index="III">Insider Radar</SectionLabel>
            </Reveal>
            <Reveal variant="lines" delay={60}>
              <EditorialHeadline
                className="mt-5 text-[clamp(1.8rem,4.2vw,3rem)] leading-[0.95]"
                lines={[
                  "THE FILINGS",
                  "ARE PUBLIC.",
                  <span key="i" className="text-mk-muted">
                    THE INSIGHT
                  </span>,
                  <span key="t" className="text-mk-muted">
                    TAKES WORK.
                  </span>,
                ]}
              />
            </Reveal>
            <Reveal delay={140}>
              <p className="mt-6 max-w-sm text-pretty text-[13.5px] leading-relaxed text-mk-muted">
                Company insiders disclose certain securities transactions. Wands
                helps you organise those filings, explore purchase and sale
                activity, and trace signals back to the original evidence.
              </p>
              <div className="mt-6 border-l border-mk-line pl-4">
                <MarginNote label="Product caption">
                  Explore the transaction. Check the filing. Understand when the
                  information became public.
                </MarginNote>
              </div>
              <Link
                href="/features/insider-radar"
                className="group mt-7 inline-flex items-center gap-1.5 font-marketing-mono text-[10px] tracking-[0.14em] text-mk-accent uppercase"
              >
                Explore Insider Intelligence
                <ArrowRight
                  className="size-3.5 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </Reveal>
          </div>

          <Reveal delay={120} className="min-w-0">
            <div className="mb-2 flex justify-end">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-mk-accent/30 px-2.5 py-1">
                <span className="size-1 rounded-full bg-mk-accent" aria-hidden />
                <span className="font-marketing-mono text-[8.5px] tracking-[0.12em] text-mk-accent uppercase">
                  Score = evidence, not probability
                </span>
              </span>
            </div>
            <InsiderScreen />
            <p className="mt-3 font-marketing-mono text-[9px] tracking-[0.14em] text-mk-dim uppercase">
              Illustrative interface · demonstration data
            </p>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

export function ActInstitutional() {
  return (
    <section className="relative border-t border-mk-line bg-mk-deep/40 py-16 sm:py-24">
      <Container width="wide">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.28fr)_minmax(0,0.72fr)] lg:gap-12">
          <Reveal delay={120} className="order-2 min-w-0 lg:order-1">
            <div className="mb-2 flex justify-start">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-mk-warn/30 px-2.5 py-1">
                <span className="size-1 rounded-full bg-mk-warn" aria-hidden />
                <span className="font-marketing-mono text-[8.5px] tracking-[0.12em] text-mk-warn uppercase">
                  Disclosed up to 45 days after quarter end
                </span>
              </span>
            </div>
            <InstitutionScreen />
            <p className="mt-3 font-marketing-mono text-[9px] tracking-[0.14em] text-mk-dim uppercase">
              Illustrative interface · demonstration data
            </p>
          </Reveal>

          <div className="order-1 lg:order-2 lg:sticky lg:top-24 lg:self-start">
            <Reveal>
              <SectionLabel index="IV">Institutional Radar</SectionLabel>
            </Reveal>
            <Reveal variant="lines" delay={60}>
              <EditorialHeadline
                className="mt-5 text-[clamp(1.8rem,4.2vw,3rem)] leading-[0.95]"
                lines={[
                  "FOLLOW THE",
                  "HOLDINGS.",
                  <span key="q" className="text-mk-muted">
                    QUESTION THE
                  </span>,
                  <span key="n" className="text-mk-muted">
                    NARRATIVE.
                  </span>,
                ]}
              />
            </Reveal>
            <Reveal delay={140}>
              <p className="mt-6 max-w-sm text-pretty text-[13.5px] leading-relaxed text-mk-muted">
                Explore institutional holdings disclosures, reported position
                changes and the context behind quarterly filings — all without
                pretending delayed information is a real-time trade feed.
              </p>
              <Link
                href="/features/institutional-radar"
                className="group mt-7 inline-flex items-center gap-1.5 font-marketing-mono text-[10px] tracking-[0.14em] text-mk-accent uppercase"
              >
                See Institutional Research
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

const components = [
  { label: "Cluster activity", value: 96 },
  { label: "Role seniority", value: 88 },
  { label: "Size vs. history", value: 91 },
  { label: "Filing recency", value: 84 },
];

export function ActSignal() {
  return (
    <section className="relative border-t border-mk-line py-16 sm:py-24">
      <Container width="narrow">
        <div className="text-center">
          <Reveal>
            <SectionLabel index="V" className="justify-center">
              Signal intelligence
            </SectionLabel>
          </Reveal>
          <Reveal variant="lines" delay={60}>
            <EditorialHeadline
              className="mt-5 text-[clamp(1.8rem,4.6vw,3.25rem)] leading-[0.95]"
              lines={[
                "NOT ANOTHER BUY SIGNAL.",
                <span key="r" className="text-mk-muted">
                  A REASON TO LOOK CLOSER.
                </span>,
              ]}
            />
          </Reveal>
          <Reveal delay={140}>
            <p className="mx-auto mt-6 max-w-lg text-pretty text-[13.5px] leading-relaxed text-mk-muted">
              Wands organises research indicators, explains the evidence behind
              them and makes the gaps visible. Because a useful question is worth
              more than an unexplained prediction.
            </p>
          </Reveal>
        </div>

        <Reveal delay={200} className="mt-10">
          <div className="overflow-hidden rounded-xl border border-mk-line-strong bg-mk-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-mk-line px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="font-marketing-mono text-[11px] tracking-[0.1em] text-mk-fg">
                  NVDA
                </span>
                <span className="font-marketing-mono text-[9px] tracking-[0.1em] text-mk-dim uppercase">
                  Insider cluster
                </span>
              </div>
              <span className="font-marketing-mono text-[8.5px] tracking-[0.12em] text-mk-dim uppercase">
                Demonstration data
              </span>
            </div>

            <div className="grid gap-0 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <div className="flex flex-col justify-center border-b border-mk-line px-4 py-5 sm:border-r sm:border-b-0">
                <span className="font-editorial text-[2.75rem] leading-none font-semibold tracking-[-0.05em] text-mk-accent">
                  92
                </span>
                <span className="mt-1 font-marketing-mono text-[8.5px] tracking-[0.14em] text-mk-dim uppercase">
                  Evidence score
                </span>
              </div>

              <div className="px-4 py-5">
                <div className="flex flex-col gap-2.5">
                  {components.map((item) => (
                    <div key={item.label} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-[11px] text-mk-muted">
                        {item.label}
                      </span>
                      <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-mk-raised">
                        <span
                          className="block h-full rounded-full bg-mk-accent/70"
                          style={{ width: `${item.value}%` }}
                        />
                      </span>
                      <span className="w-6 shrink-0 text-right font-marketing-mono text-[9.5px] tabular-nums text-mk-dim">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-mk-line pt-3">
                  {[
                    ["Source", "SEC Form 4"],
                    ["Filed", "2026-11-04"],
                    ["Records", "3 insiders"],
                  ].map(([label, value]) => (
                    <span key={label} className="flex items-baseline gap-1.5">
                      <span className="font-marketing-mono text-[8.5px] tracking-[0.12em] text-mk-dim uppercase">
                        {label}
                      </span>
                      <span className="font-marketing-mono text-[9.5px] text-mk-muted">
                        {value}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-mk-line bg-mk-deep/50 px-4 py-2.5">
              <p className="text-[10.5px] leading-relaxed text-mk-dim">
                A score ranks evidence. It is not a forecast, and it is not a
                probability of profit.
              </p>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

const labFeatures = [
  {
    title: "Historical research experiments",
    body: "Define a hypothesis, run it across the stored history and keep the result even when it disappoints.",
  },
  {
    title: "Cost-aware performance analysis",
    body: "Commission and slippage are modelled before a result is allowed to look interesting.",
  },
  {
    title: "Data-quality reporting",
    body: "Coverage, gaps and freshness are reported next to the result, not buried in a footnote.",
  },
  {
    title: "Transparent limitations",
    body: "Anything unproven stays labelled in development until it survives out-of-sample testing.",
  },
];

export function ActResearch() {
  return (
    <section
      id="research"
      className="relative scroll-mt-20 border-t border-mk-line bg-mk-deep/40 py-16 sm:py-24"
    >
      <Container width="wide">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <Reveal>
              <SectionLabel index="VI">Research Lab</SectionLabel>
            </Reveal>
            <Reveal variant="lines" delay={60}>
              <EditorialHeadline
                className="mt-5 max-w-2xl text-[clamp(1.9rem,4.6vw,3.25rem)] leading-[0.94]"
                lines={[
                  "INTERESTING ISN'T",
                  <span key="p" className="text-mk-muted">
                    THE SAME AS PROVEN.
                  </span>,
                ]}
              />
            </Reveal>
          </div>
          <Reveal delay={140}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-mk-warn/30 bg-mk-warn/10 px-2.5 py-1 font-marketing-mono text-[8.5px] tracking-[0.14em] text-mk-warn uppercase">
              <span className="size-1 rounded-full bg-mk-warn" aria-hidden />
              In development
            </span>
          </Reveal>
        </div>

        <Reveal delay={120}>
          <p className="mt-6 max-w-xl text-pretty text-[13.5px] leading-relaxed text-mk-muted">
            A pattern that looks impressive deserves to be tested. Wands is
            developing tools to investigate historical outcomes, compare research
            hypotheses and expose where evidence is incomplete.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14">
          <Reveal delay={160}>
            <ul className="flex flex-col">
              {labFeatures.map((feature) => (
                <li
                  key={feature.title}
                  className="flex flex-col gap-1.5 border-t border-mk-line py-4 first:border-0 first:pt-0"
                >
                  <h3 className="text-[13px] font-medium text-mk-fg">
                    {feature.title}
                  </h3>
                  <p className="text-[12px] leading-relaxed text-mk-muted">
                    {feature.body}
                  </p>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={200}>
            <PerformanceScreen />
            <p className="mt-3 font-marketing-mono text-[9px] tracking-[0.14em] text-mk-dim uppercase">
              Illustrative interface · no performance figures are published
            </p>
          </Reveal>
        </div>

        <Reveal delay={120}>
          <Link
            href="/features/strategy-lab"
            className="group mt-10 inline-flex items-center gap-1.5 font-marketing-mono text-[10px] tracking-[0.14em] text-mk-accent uppercase"
          >
            Inside Strategy Lab
            <ArrowUpRight
              className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              aria-hidden
            />
          </Link>
        </Reveal>
      </Container>
    </section>
  );
}
