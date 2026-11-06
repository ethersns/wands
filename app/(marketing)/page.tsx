import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AvailabilityBadge } from "@/components/marketing/availability-badge";
import { ButtonLink } from "@/components/marketing/button-link";
import { Container } from "@/components/marketing/container";
import { CtaBand } from "@/components/marketing/cta-band";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { PricingTable } from "@/components/marketing/pricing-table";
import { ProductShowcase } from "@/components/marketing/product-showcase";
import { Reveal } from "@/components/marketing/reveal";
import { SectionHeading } from "@/components/marketing/section-heading";
import { CommandCentreShowcase } from "@/components/marketing/showcase/command-centre";
import { InsiderRadarShowcase } from "@/components/marketing/showcase/insider-radar";
import { InstitutionalRadarShowcase } from "@/components/marketing/showcase/institutional-radar";
import { StrategyLabShowcase } from "@/components/marketing/showcase/strategy-lab";
import { checkoutAvailableFor } from "@/lib/billing/config";
import { capabilities, featureDetails } from "@/lib/marketing/features";
import { faqItems } from "@/lib/marketing/faq";
import { siteDescription } from "@/lib/marketing/site";

export const metadata: Metadata = {
  title: "Wands — Market intelligence for people who trade on evidence",
  description: siteDescription,
  alternates: { canonical: "/" },
};

const sources = [
  "SEC EDGAR",
  "Form 4 insider transactions",
  "Form 13F holdings",
  "OHLCV market data",
  "Filing-level provenance",
];

const gaps = [
  {
    title: "Fragmented sources",
    body: "Insider filings live in EDGAR. Holdings live in 13F filings. Prices live somewhere else. By the time you have stitched them together, the move has already happened.",
  },
  {
    title: "Unverifiable claims",
    body: "A score with no source is a rumour. If you cannot see the filing, the date and the freshness behind a number, you cannot size a position on it.",
  },
  {
    title: "No feedback loop",
    body: "Most tools stop at the idea. Nothing tests whether it survives out-of-sample data, commissions and slippage — which is where most ideas die.",
  },
];

const steps = [
  {
    number: "01",
    title: "Connect",
    body: "Link an exchange or broker. Connections are read-only by default, and trading permission is opt-in per connection.",
  },
  {
    number: "02",
    title: "Collect",
    body: "Wands ingests filings, holdings and market data on a schedule, and records the freshness of every source it touches.",
  },
  {
    number: "03",
    title: "Decide",
    body: "Rank the signals, validate the thesis in Strategy Lab, then size the position against the risk limits you set.",
  },
];

const controls = [
  {
    title: "Keys stay server-side",
    body: "Exchange credentials are stored encrypted and never sent to the browser.",
  },
  {
    title: "Read-only by default",
    body: "Every connection starts without trading permission. You grant it explicitly, per connection.",
  },
  {
    title: "One control stops everything",
    body: "A single action halts every bot and cancels open orders across all accounts.",
  },
  {
    title: "Every action is recorded",
    body: "Orders, signals and configuration changes are logged with a timestamp and an actor.",
  },
  {
    title: "Paper before capital",
    body: "Run a strategy end-to-end on a paper account before it is allowed near real money.",
  },
];

export default function LandingPage() {
  const checkoutAvailable = checkoutAvailableFor("operator");

  return (
    <>
      <section className="relative overflow-hidden border-b border-mk-line">
        <div
          className="mk-grid mk-fade-b pointer-events-none absolute inset-0 opacity-70"
          aria-hidden
        />
        <Container className="relative">
          <Reveal className="flex flex-col items-center pt-20 pb-12 text-center sm:pt-28 sm:pb-16">
            <Eyebrow>Private beta · Waitlist open</Eyebrow>
            <h1 className="mt-6 max-w-4xl font-display text-[2.6rem] leading-[0.98] font-semibold tracking-[-0.045em] text-balance text-mk-fg sm:text-6xl lg:text-[4.25rem]">
              The market moves fast.{" "}
              <span className="text-mk-accent">See the bigger picture.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-[15.5px] leading-relaxed text-mk-muted sm:text-[17px]">
              Wands reads SEC filings, institutional holdings and market data,
              then ranks what actually changed. Every signal carries its source,
              its filing date and its freshness — so you can act on evidence
              instead of noise.
            </p>
            <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <ButtonLink href="/#access" size="lg">
                Request access
              </ButtonLink>
              <ButtonLink href="#product" variant="secondary" size="lg">
                See how it works
              </ButtonLink>
            </div>
            <p className="mt-5 font-marketing-mono text-[10px] tracking-[0.12em] text-mk-dim uppercase">
              No card required · Invites sent weekly · Read-only by default
            </p>
          </Reveal>

          <Reveal delay={120} className="relative pb-14 sm:pb-20">
            <CommandCentreShowcase />
            <p className="mt-4 text-center font-marketing-mono text-[10px] tracking-[0.1em] text-mk-dim uppercase">
              Illustrative interface · Demonstration data, not live market data
            </p>
          </Reveal>
        </Container>
      </section>

      <div className="border-b border-mk-line bg-mk-deep/60">
        <Container>
          <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-marketing-mono text-[10px] tracking-[0.14em] text-mk-dim uppercase">
              Built on primary sources
            </p>
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {sources.map((source) => (
                <li
                  key={source}
                  className="font-marketing-mono text-[10.5px] tracking-[0.08em] text-mk-muted uppercase"
                >
                  {source}
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </div>

      <section className="border-b border-mk-line py-16 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="The gap"
            title="Most signals are opinions with a chart attached."
            description="Three things break between a filing being published and a position being sized. Wands is built around all three."
            className="max-w-3xl"
          />
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {gaps.map((gap) => (
              <div
                key={gap.title}
                className="flex flex-col gap-2 border-t border-mk-line pt-5"
              >
                <h3 className="text-[14px] font-medium text-mk-fg">
                  {gap.title}
                </h3>
                <p className="text-[13px] leading-relaxed text-mk-muted">
                  {gap.body}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <div id="product" className="scroll-mt-20">
        <Container>
          <Reveal>
            <ProductShowcase
              eyebrow={featureDetails[0].eyebrow}
              title={featureDetails[0].headline}
              description={featureDetails[0].subhead}
              visual={<InsiderRadarShowcase />}
              highlights={featureDetails[0].highlights}
              footnote={featureDetails[0].footnote}
              cta={{ href: "/features/insider-radar", label: "Inside Insider Radar" }}
            />
          </Reveal>

          <div className="border-t border-mk-line">
            <Reveal>
              <ProductShowcase
                eyebrow={featureDetails[1].eyebrow}
                title={featureDetails[1].headline}
                description={featureDetails[1].subhead}
                visual={<InstitutionalRadarShowcase />}
                highlights={featureDetails[1].highlights}
                footnote={featureDetails[1].footnote}
                cta={{
                  href: "/features/institutional-radar",
                  label: "Inside Institutional Radar",
                }}
              />
            </Reveal>
          </div>

          <div className="border-t border-mk-line">
            <Reveal>
              <ProductShowcase
                eyebrow={featureDetails[2].eyebrow}
                title={featureDetails[2].headline}
                description={featureDetails[2].subhead}
                visual={<StrategyLabShowcase />}
                highlights={featureDetails[2].highlights}
                footnote={featureDetails[2].footnote}
                cta={{ href: "/features/strategy-lab", label: "Inside Strategy Lab" }}
              />
            </Reveal>
          </div>
        </Container>
      </div>

      <section className="border-t border-mk-line bg-mk-deep/40 py-16 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="How it works"
            title="From filing to position, in one place."
            className="max-w-2xl"
          />
          <ol className="mt-12 grid gap-8 sm:grid-cols-3">
            {steps.map((step) => (
              <li
                key={step.number}
                className="flex flex-col gap-3 border-t border-mk-line pt-5"
              >
                <span className="font-marketing-mono text-[11px] tracking-[0.14em] text-mk-accent">
                  {step.number}
                </span>
                <h3 className="font-display text-[17px] font-semibold tracking-[-0.02em] text-mk-fg">
                  {step.title}
                </h3>
                <p className="text-[13px] leading-relaxed text-mk-muted">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="border-t border-mk-line py-16 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="Capabilities"
            title="What is in the terminal today."
            description="Labelled honestly. Anything that is not ready is marked beta or planned rather than quietly shipped."
            className="max-w-2xl"
          />
          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-mk-line bg-mk-line sm:grid-cols-2 lg:grid-cols-4">
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

      <section className="border-t border-mk-line py-16 sm:py-20">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
            <div className="flex flex-col gap-4">
              <Eyebrow>Control</Eyebrow>
              <h2 className="font-display text-balance text-3xl font-semibold tracking-[-0.035em] text-mk-fg sm:text-4xl">
                Built for people who are careful with capital.
              </h2>
              <p className="text-pretty text-[15px] leading-relaxed text-mk-muted">
                Automation is only useful if you can stop it. Every control below
                is part of the product, not a setting buried in a support
                article.
              </p>
              <Link
                href="/security"
                className="group inline-flex items-center gap-1.5 text-[13.5px] font-medium text-mk-accent"
              >
                Read the security overview
                <ArrowRight
                  className="size-3.5 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </div>
            <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {controls.map((control) => (
                <li
                  key={control.title}
                  className="flex flex-col gap-1.5 border-t border-mk-line pt-4"
                >
                  <h3 className="text-[13.5px] font-medium text-mk-fg">
                    {control.title}
                  </h3>
                  <p className="text-[12.5px] leading-relaxed text-mk-muted">
                    {control.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section className="border-t border-mk-line bg-mk-deep/40 py-16 sm:py-20">
        <Container>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeading
              eyebrow="Pricing"
              title="Free while we are in beta."
              description="Billing is not enabled yet. Every plan is free during the private beta, and we will give notice before anything is charged."
              className="max-w-2xl"
            />
            <ButtonLink href="/pricing" variant="secondary" size="md">
              Compare plans
            </ButtonLink>
          </div>
          <PricingTable checkoutAvailable={checkoutAvailable} className="mt-10" />
        </Container>
      </section>

      <section className="border-t border-mk-line py-16 sm:py-20">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <SectionHeading
              eyebrow="Questions"
              title="The things people ask before signing up."
            />
            <FaqAccordion items={faqItems.slice(0, 6)} />
          </div>
        </Container>
      </section>

      <CtaBand source="landing" />
    </>
  );
}
