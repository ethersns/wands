import type { Metadata } from "next";

import { Container } from "@/components/marketing/container";
import { CtaBand } from "@/components/marketing/cta-band";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { SectionHeading } from "@/components/marketing/section-heading";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How Wands handles exchange credentials, trading permissions, audit logging and the controls that let you stop automation immediately.",
  alternates: { canonical: "/security" },
};

const sections = [
  {
    title: "Credentials",
    points: [
      "Exchange and broker API keys are stored encrypted at rest and are never sent to the browser.",
      "Keys are used only by server-side processes that need them, and are never written to logs.",
      "You can revoke a connection at any time, which deletes the stored credential.",
    ],
  },
  {
    title: "Trading permissions",
    points: [
      "Every connection starts read-only. Trading permission is a separate, explicit grant per connection.",
      "Withdrawal and transfer permissions are never requested and are not supported.",
      "A single control halts every bot and cancels open orders across all accounts.",
    ],
  },
  {
    title: "Access and audit",
    points: [
      "Accounts are created only after Stripe confirms a paid subscription. There is no free sign-up and no free trial.",
      "Orders, signals and configuration changes are recorded with a timestamp and an actor.",
      "Sessions are server-validated on every request; the client never holds authority over identity.",
    ],
  },
  {
    title: "Data handling",
    points: [
      "Market and filing data is sourced from public records. Your positions, watchlists and backtests are private to your account.",
      "Waitlist and contact submissions are stored only to operate the beta and respond to you.",
      "You can request deletion of your account and associated data at any time.",
    ],
  },
];

export default function SecurityPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-mk-line">
        <div
          className="mk-grid mk-fade-b pointer-events-none absolute inset-0 opacity-60"
          aria-hidden
        />
        <Container className="relative">
          <div className="flex max-w-3xl flex-col gap-5 py-16 sm:py-24">
            <Eyebrow>Security</Eyebrow>
            <h1 className="font-display text-balance text-4xl font-semibold tracking-[-0.04em] text-mk-fg sm:text-5xl lg:text-[3.5rem] lg:leading-[1.02]">
              Automation you can stop.
            </h1>
            <p className="max-w-2xl text-pretty text-[15.5px] leading-relaxed text-mk-muted sm:text-[17px]">
              A trading system is a security system first. This page describes
              what Wands does today, in plain terms, without certification claims
              we cannot back up.
            </p>
          </div>
        </Container>
      </section>

      <Container>
        <div className="grid gap-10 py-12 sm:py-16 lg:grid-cols-2 lg:gap-x-16">
          {sections.map((section) => (
            <section key={section.title} className="flex flex-col gap-3">
              <h2 className="font-display text-[19px] font-semibold tracking-[-0.02em] text-mk-fg">
                {section.title}
              </h2>
              <ul className="flex flex-col gap-2.5 border-t border-mk-line pt-4">
                {section.points.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-2.5 text-[13px] leading-relaxed text-mk-muted"
                  >
                    <span
                      className="mt-1.5 size-1 shrink-0 rounded-full bg-mk-accent/70"
                      aria-hidden
                    />
                    {point}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="border-t border-mk-line py-12 sm:py-16">
          <SectionHeading
            eyebrow="Status"
            title="What we do not claim."
            description="Wands is an independent product. We do not hold third-party security certifications today. When that changes, the certificates and their scope will be published on this page rather than implied in marketing copy."
            className="max-w-3xl"
          />
          <div className="mt-8 rounded-xl border border-mk-line bg-mk-surface p-5">
            <p className="text-[13px] leading-relaxed text-mk-muted">
              If you are evaluating Wands for a fund or an institution and need a
              written security questionnaire completed, use the contact form and
              select <span className="text-mk-fg">Security review</span>. We will
              answer in writing.
            </p>
          </div>
        </div>
      </Container>

      <CtaBand source="security" />
    </>
  );
}
