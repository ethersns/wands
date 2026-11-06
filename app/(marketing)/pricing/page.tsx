import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";

import { Container } from "@/components/marketing/container";
import { CtaBand } from "@/components/marketing/cta-band";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { PricingTable } from "@/components/marketing/pricing-table";
import { SectionHeading } from "@/components/marketing/section-heading";
import { checkoutAvailableFor } from "@/lib/billing/config";
import { pricingFaq } from "@/lib/marketing/pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Wands pricing. Free during the private beta, with published plans for when billing opens.",
  alternates: { canonical: "/pricing" },
};

const matrix: { feature: string; observer: boolean; operator: boolean; desk: boolean }[] = [
  { feature: "Insider Radar", observer: true, operator: true, desk: true },
  { feature: "Institutional Radar", observer: true, operator: true, desk: true },
  { feature: "Signal history", observer: false, operator: true, desk: true },
  { feature: "Strategy Lab", observer: false, operator: true, desk: true },
  { feature: "Out-of-sample validation", observer: false, operator: true, desk: true },
  { feature: "Risk Centre with enforced limits", observer: false, operator: true, desk: true },
  { feature: "Paper trading accounts", observer: false, operator: true, desk: true },
  { feature: "Multiple portfolios", observer: false, operator: false, desk: true },
  { feature: "Automated bots", observer: false, operator: false, desk: true },
  { feature: "API access", observer: false, operator: false, desk: true },
];

export default function PricingPage() {
  const checkoutAvailable = checkoutAvailableFor("operator");

  return (
    <>
      <section className="relative overflow-hidden border-b border-mk-line">
        <div
          className="mk-grid mk-fade-b pointer-events-none absolute inset-0 opacity-60"
          aria-hidden
        />
        <Container className="relative">
          <div className="flex max-w-3xl flex-col gap-5 py-16 sm:py-24">
            <Eyebrow>Pricing</Eyebrow>
            <h1 className="font-display text-balance text-4xl font-semibold tracking-[-0.04em] text-mk-fg sm:text-5xl lg:text-[3.5rem] lg:leading-[1.02]">
              Free while we are in beta.
            </h1>
            <p className="max-w-2xl text-pretty text-[15.5px] leading-relaxed text-mk-muted sm:text-[17px]">
              Billing is not enabled yet. Every plan is free during the private
              beta, and we will give existing members notice before anything is
              charged. The prices below are what it will cost when billing opens.
            </p>
          </div>
        </Container>
      </section>

      <Container>
        <div className="py-12 sm:py-16">
          <PricingTable checkoutAvailable={checkoutAvailable} />
          <p className="mt-6 font-marketing-mono text-[10px] tracking-[0.1em] text-mk-dim uppercase">
            Prices in USD · Billing disabled during beta · No card required
          </p>
        </div>

        <div className="border-t border-mk-line py-12 sm:py-16">
          <SectionHeading
            eyebrow="Compare"
            title="What each plan includes."
            className="max-w-2xl"
          />
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left">
              <caption className="sr-only">
                Feature comparison across the Observer, Operator and Desk plans
              </caption>
              <thead>
                <tr className="border-b border-mk-line">
                  <th
                    scope="col"
                    className="py-3 pr-4 font-marketing-mono text-[9.5px] font-medium tracking-[0.12em] text-mk-dim uppercase"
                  >
                    Feature
                  </th>
                  {["Observer", "Operator", "Desk"].map((plan) => (
                    <th
                      key={plan}
                      scope="col"
                      className="px-3 py-3 text-center font-marketing-mono text-[9.5px] font-medium tracking-[0.12em] text-mk-dim uppercase"
                    >
                      {plan}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr
                    key={row.feature}
                    className="border-b border-mk-line/60 last:border-0"
                  >
                    <th
                      scope="row"
                      className="py-3 pr-4 text-left text-[13px] font-normal text-mk-muted"
                    >
                      {row.feature}
                    </th>
                    {[row.observer, row.operator, row.desk].map((included, index) => (
                      <td key={index} className="px-3 py-3 text-center">
                        {included ? (
                          <Check
                            className="mx-auto size-3.5 text-mk-accent"
                            aria-label="Included"
                          />
                        ) : (
                          <Minus
                            className="mx-auto size-3.5 text-mk-dim"
                            aria-label="Not included"
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-10 border-t border-mk-line py-12 sm:py-16 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <SectionHeading eyebrow="Billing" title="Questions about paying." />
          <FaqAccordion items={pricingFaq} />
        </div>
      </Container>

      <CtaBand
        source="pricing"
        title="Join the beta and skip the invoice."
        description="Beta accounts are free. Join the waitlist and we will invite you when your cohort opens."
      />
    </>
  );
}
