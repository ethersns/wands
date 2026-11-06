import type { Metadata } from "next";

import { Container } from "@/components/marketing/container";
import { CtaBand } from "@/components/marketing/cta-band";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { SectionHeading } from "@/components/marketing/section-heading";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why Wands exists: a market intelligence terminal built on primary sources, with provenance attached to every signal.",
  alternates: { canonical: "/about" },
};

const principles = [
  {
    title: "Provenance is not optional",
    body: "Every number in the terminal can be traced to the filing or feed it came from, along with the date it was published and the time it was ingested. If we cannot show the source, we do not show the number.",
  },
  {
    title: "Freshness is part of the data",
    body: "A 13F describes a quarter that has already ended. A Form 4 can be filed two business days after the trade. Wands displays that lag next to the figure instead of hiding it in a footnote.",
  },
  {
    title: "Validation before conviction",
    body: "An idea is not a strategy until it has survived costs, slippage and data it was not fitted to. Strategy Lab exists so that test happens before capital is committed, not after.",
  },
  {
    title: "Honest labelling",
    body: "Features are marked available, beta or planned. Nothing is described as shipped when it is a roadmap item, and demonstration data is labelled as demonstration data.",
  },
];

const refusals = [
  "We do not sell signals, manage money, or take a share of your returns.",
  "We do not claim certifications, licences or regulatory status we do not hold.",
  "We do not publish performance figures as if they were a track record.",
];

export default function AboutPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-mk-line">
        <div
          className="mk-grid mk-fade-b pointer-events-none absolute inset-0 opacity-60"
          aria-hidden
        />
        <Container className="relative">
          <div className="flex max-w-3xl flex-col gap-5 py-16 sm:py-24">
            <Eyebrow>About</Eyebrow>
            <h1 className="font-display text-balance text-4xl font-semibold tracking-[-0.04em] text-mk-fg sm:text-5xl lg:text-[3.5rem] lg:leading-[1.02]">
              Evidence first, or not at all.
            </h1>
            <p className="max-w-2xl text-pretty text-[15.5px] leading-relaxed text-mk-muted sm:text-[17px]">
              Wands is an independent software project. It exists because the
              tools available for reading filings were either too shallow to
              trust or too expensive to try, and the tools for acting on them
              rarely showed their work.
            </p>
          </div>
        </Container>
      </section>

      <Container>
        <div className="grid gap-10 border-b border-mk-line py-12 sm:py-16 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <SectionHeading eyebrow="What it is" title="A terminal, not a newsletter." />
          <div className="flex flex-col gap-4 text-[14px] leading-relaxed text-mk-muted">
            <p>
              Wands ingests SEC filings, institutional holdings and market data,
              ranks what changed, and gives you one place to validate a thesis
              and control the risk around it. It covers equities and crypto in
              the same portfolio view.
            </p>
            <p>
              It is deliberately narrow. Wands is not a social network, it does
              not publish trade ideas, and it will not tell you what to buy. It
              is a set of instruments for people who already have a view and want
              better evidence for it.
            </p>
            <p>
              The product is in private beta. Access is granted in small cohorts
              so that every account is supported properly, and features ship
              continuously rather than in annual releases.
            </p>
          </div>
        </div>

        <div className="border-b border-mk-line py-12 sm:py-16">
          <SectionHeading
            eyebrow="Principles"
            title="Four rules we build by."
            className="max-w-2xl"
          />
          <div className="mt-10 grid gap-8 sm:grid-cols-2">
            {principles.map((principle) => (
              <div
                key={principle.title}
                className="flex flex-col gap-2 border-t border-mk-line pt-5"
              >
                <h3 className="text-[14px] font-medium text-mk-fg">
                  {principle.title}
                </h3>
                <p className="text-[13px] leading-relaxed text-mk-muted">
                  {principle.body}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-10 py-12 sm:py-16 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <SectionHeading eyebrow="Boundaries" title="What we will not do." />
          <ul className="flex flex-col gap-4">
            {refusals.map((refusal) => (
              <li
                key={refusal}
                className="flex items-start gap-3 border-t border-mk-line pt-4 text-[13.5px] leading-relaxed text-mk-muted"
              >
                <span
                  className="mt-1.5 size-1 shrink-0 rounded-full bg-mk-warn/70"
                  aria-hidden
                />
                {refusal}
              </li>
            ))}
          </ul>
        </div>
      </Container>

      <CtaBand source="about" />
    </>
  );
}
