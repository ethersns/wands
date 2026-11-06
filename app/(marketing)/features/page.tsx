import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AvailabilityBadge } from "@/components/marketing/availability-badge";
import { Container } from "@/components/marketing/container";
import { CtaBand } from "@/components/marketing/cta-band";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { SectionHeading } from "@/components/marketing/section-heading";
import { capabilities, featureDetails } from "@/lib/marketing/features";

export const metadata: Metadata = {
  title: "Product",
  description:
    "Insider Radar, Institutional Radar and Strategy Lab: the three surfaces that turn filings and market data into evidence you can act on.",
  alternates: { canonical: "/features" },
};

export default function FeaturesPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-mk-line">
        <div
          className="mk-grid mk-fade-b pointer-events-none absolute inset-0 opacity-60"
          aria-hidden
        />
        <Container className="relative">
          <div className="flex max-w-3xl flex-col gap-5 py-16 sm:py-24">
            <Eyebrow>Product</Eyebrow>
            <h1 className="font-display text-balance text-4xl font-semibold tracking-[-0.04em] text-mk-fg sm:text-5xl lg:text-[3.5rem] lg:leading-[1.02]">
              Three surfaces. One question: what actually changed?
            </h1>
            <p className="max-w-2xl text-pretty text-[15.5px] leading-relaxed text-mk-muted sm:text-[17px]">
              Wands is not a screener with a news feed bolted on. It is built
              around events — a cluster of insider purchases, a fund building a
              position, a thesis that survives out-of-sample data — and it shows
              you the source for every one.
            </p>
          </div>
        </Container>
      </section>

      <Container>
        <div className="divide-y divide-mk-line">
          {featureDetails.map((feature, index) => (
            <article
              key={feature.slug}
              className="grid gap-6 py-12 sm:py-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16"
            >
              <div className="flex flex-col gap-4">
                <span className="font-marketing-mono text-[11px] tracking-[0.14em] text-mk-accent">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h2 className="font-display text-balance text-2xl font-semibold tracking-[-0.03em] text-mk-fg sm:text-3xl">
                  {feature.headline}
                </h2>
                <p className="text-[14px] leading-relaxed text-mk-muted">
                  {feature.subhead}
                </p>
                <Link
                  href={`/features/${feature.slug}`}
                  className="group inline-flex items-center gap-1.5 text-[13.5px] font-medium text-mk-accent"
                >
                  Read the detail
                  <ArrowRight
                    className="size-3.5 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </div>
              <div className="flex flex-col gap-4">
                <p className="text-[13px] leading-relaxed text-mk-muted">
                  {feature.problem}
                </p>
                <ul className="flex flex-col gap-2.5 border-t border-mk-line pt-4">
                  {feature.highlights.map((highlight) => (
                    <li key={highlight.title} className="flex flex-col gap-0.5">
                      <span className="text-[12.5px] font-medium text-mk-fg">
                        {highlight.title}
                      </span>
                      <span className="text-[12.5px] leading-relaxed text-mk-muted">
                        {highlight.body}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </Container>

      <section className="border-t border-mk-line bg-mk-deep/40 py-16 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="Everything else"
            title="The rest of the terminal."
            description="Labelled by what is actually shipped. Nothing here is a roadmap promise dressed up as a feature."
            className="max-w-2xl"
          />
          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-mk-line bg-mk-line sm:grid-cols-2 lg:grid-cols-4">
            {capabilities.map((capability) => (
              <div
                key={capability.name}
                className="flex flex-col gap-2 bg-mk-surface p-5"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[13.5px] font-medium text-mk-fg">
                    {capability.name}
                  </h3>
                  <AvailabilityBadge availability={capability.availability} />
                </div>
                <p className="text-[12.5px] leading-relaxed text-mk-muted">
                  {capability.summary}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <CtaBand source="features" />
    </>
  );
}
