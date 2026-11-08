import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { PricingTable } from "@/components/marketing/pricing-table";
import { SectionHeading } from "@/components/marketing/section-heading";
import {
  billingBlockedReason,
  checkoutAvailableFor,
  formatMembershipPrice,
  getMembershipPrice,
} from "@/lib/billing/config";
import { pricingFaq } from "@/lib/marketing/pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Wands Founding Access. One membership, billed monthly, with no free tier and no free trial.",
  alternates: { canonical: "/pricing" },
};

export default async function PricingPage() {
  const price = await getMembershipPrice("founding");
  const checkoutAvailable = checkoutAvailableFor("founding");

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
              One membership. Everything in the workspace.
            </h1>
            <p className="max-w-2xl text-pretty text-[15.5px] leading-relaxed text-mk-muted sm:text-[17px]">
              Wands is a paid research platform. There is no free tier and no free
              trial — every account is backed by an active subscription, which is
              what pays for the filings, insider records and institutional data
              behind the research.
            </p>
          </div>
        </Container>
      </section>

      <Container>
        <div className="py-12 sm:py-16">
          <PricingTable
            priceLabel={formatMembershipPrice(price)}
            priceConfirmed={price.confirmed}
            checkoutAvailable={checkoutAvailable}
          />
          <p className="mt-6 font-marketing-mono text-[10px] tracking-[0.1em] text-mk-dim uppercase">
            {checkoutAvailable
              ? "Prices in USD · Billed monthly · Secure checkout through Stripe"
              : (billingBlockedReason ?? "Billing is not open yet")}
          </p>
        </div>

        <div className="grid gap-10 border-t border-mk-line py-12 sm:py-16 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <SectionHeading eyebrow="Billing" title="Questions about paying." />
          <FaqAccordion items={pricingFaq} />
        </div>

        <div className="flex flex-col items-start gap-4 border-t border-mk-line py-12 sm:flex-row sm:items-center sm:justify-between sm:py-16">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-[-0.03em] text-mk-fg text-balance">
              Ready when you are.
            </h2>
            <p className="mt-2 max-w-md text-[14px] leading-relaxed text-mk-muted text-pretty">
              Payment first, then activation, then the workspace. Nothing is
              charged until you complete checkout.
            </p>
          </div>
          <Link
            href={checkoutAvailable ? "/signup" : "/#access"}
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-mk-accent px-5 py-3 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90"
          >
            {checkoutAvailable ? "Get access" : "Join the waitlist"}
          </Link>
        </div>
      </Container>
    </>
  );
}
