import { Container } from "./container";
import { EditorialHeadline, SectionLabel } from "./editorial";
import { Reveal } from "./reveal";

const directions = [
  {
    name: "Opportunity Desk",
    status: "In development",
    body: "Private short-term research and manual paper-testing tools. A place to work a thesis through by hand, on your own terms, before anything gets automated.",
    detail: "Short-horizon research · manual paper testing",
  },
  {
    name: "Market Pulse",
    status: "In development",
    body: "Curated, sourced market news with the context that actually matters for the assets you already follow — not another infinite feed.",
    detail: "Sourced news · asset-level context",
  },
];

export function NextChapter() {
  return (
    <section className="relative border-t border-mk-line py-16 sm:py-24">
      <Container width="wide">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <Reveal>
              <SectionLabel>Next</SectionLabel>
            </Reveal>
            <Reveal variant="lines" delay={60}>
              <EditorialHeadline
                className="mt-5 max-w-2xl text-[clamp(1.9rem,4.4vw,3.1rem)] leading-[0.94]"
                lines={[
                  "THE RESEARCH",
                  "WORKSPACE IS",
                  <span key="evolving" className="text-mk-accent">
                    EVOLVING.
                  </span>,
                ]}
              />
            </Reveal>
          </div>
          <Reveal delay={140}>
            <p className="max-w-xs text-pretty text-[12.5px] leading-relaxed text-mk-muted lg:text-right">
              Two directions we&apos;re building toward. Neither is available yet —
              we&apos;ll say so when it is.
            </p>
          </Reveal>
        </div>

        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-mk-line bg-mk-line sm:grid-cols-2">
          {directions.map((direction, index) => (
            <Reveal key={direction.name} delay={160 + index * 60}>
              <div className="flex h-full flex-col gap-4 bg-mk-surface/60 p-6 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-marketing-mono text-[9px] tracking-[0.18em] text-mk-dim uppercase">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-mk-warn/30 bg-mk-warn/10 px-2.5 py-1 font-marketing-mono text-[8.5px] tracking-[0.12em] text-mk-warn uppercase">
                    <span className="size-1 rounded-full bg-mk-warn" aria-hidden />
                    {direction.status}
                  </span>
                </div>

                <h3 className="font-editorial text-[clamp(1.35rem,2.6vw,1.75rem)] leading-tight font-semibold tracking-[-0.03em] text-mk-fg">
                  {direction.name}
                </h3>

                <p className="text-pretty text-[13px] leading-relaxed text-mk-muted">
                  {direction.body}
                </p>

                <p className="mt-auto border-t border-mk-line pt-3 font-marketing-mono text-[9px] tracking-[0.14em] text-mk-dim uppercase">
                  {direction.detail}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
