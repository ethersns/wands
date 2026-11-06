import type { Metadata } from "next";

import { ContactForm } from "@/components/marketing/contact-form";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { contactEmail } from "@/lib/marketing/site";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact Wands about access, data coverage, security review or billing.",
  alternates: { canonical: "/contact" },
};

const expectations = [
  {
    title: "Access and waitlist",
    body: "Invites go out weekly, in order. If you have already joined, you do not need to ask again — you will hear from us.",
  },
  {
    title: "Data and coverage",
    body: "Tell us which filings, exchanges or instruments you need. Coverage requests shape what gets built next.",
  },
  {
    title: "Security review",
    body: "We answer written questionnaires in writing. Include your scope and deadline.",
  },
];

export default function ContactPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-mk-line">
        <div
          className="mk-grid mk-fade-b pointer-events-none absolute inset-0 opacity-60"
          aria-hidden
        />
        <Container className="relative">
          <div className="flex max-w-3xl flex-col gap-5 py-16 sm:py-24">
            <Eyebrow>Contact</Eyebrow>
            <h1 className="font-display text-balance text-4xl font-semibold tracking-[-0.04em] text-mk-fg sm:text-5xl lg:text-[3.5rem] lg:leading-[1.02]">
              Talk to a person.
            </h1>
            <p className="max-w-2xl text-pretty text-[15.5px] leading-relaxed text-mk-muted sm:text-[17px]">
              Every message is read. We reply from a monitored inbox, usually
              within two business days.
            </p>
          </div>
        </Container>
      </section>

      <Container>
        <div className="grid gap-10 py-12 sm:py-16 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
          <div className="rounded-xl border border-mk-line bg-mk-surface p-5 sm:p-6">
            <ContactForm />
          </div>

          <div className="flex flex-col gap-6">
            {expectations.map((item) => (
              <div
                key={item.title}
                className="flex flex-col gap-1.5 border-t border-mk-line pt-4"
              >
                <h2 className="text-[13.5px] font-medium text-mk-fg">
                  {item.title}
                </h2>
                <p className="text-[12.5px] leading-relaxed text-mk-muted">
                  {item.body}
                </p>
              </div>
            ))}

            {contactEmail ? (
              <div className="flex flex-col gap-1.5 border-t border-mk-line pt-4">
                <h2 className="text-[13.5px] font-medium text-mk-fg">Email</h2>
                <a
                  href={`mailto:${contactEmail}`}
                  className="font-marketing-mono text-[12.5px] text-mk-accent hover:underline"
                >
                  {contactEmail}
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </Container>
    </>
  );
}
