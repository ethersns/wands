import { legalUpdated } from "@/lib/marketing/site";

import { Container } from "./container";
import { Eyebrow } from "./eyebrow";

export function LegalPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Container width="narrow" className="py-16 sm:py-20">
      <Eyebrow>Legal</Eyebrow>
      <h1 className="mt-4 font-display text-balance text-3xl font-semibold tracking-[-0.035em] text-mk-fg sm:text-4xl">
        {title}
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mk-muted">
        {description}
      </p>
      <p className="mt-2 font-marketing-mono text-[10.5px] tracking-[0.1em] text-mk-dim uppercase">
        Last updated {legalUpdated}
      </p>

      <div className="mt-8 rounded-lg border border-mk-warn/25 bg-mk-warn/[0.06] p-4">
        <p className="text-[12.5px] leading-relaxed text-mk-warn/90">
          <span className="font-medium">Draft for review.</span> This document is
          a working template. It has not been reviewed by counsel and must be
          reviewed by a qualified lawyer in the jurisdiction you operate in
          before it is published or relied upon.
        </p>
      </div>

      <div className="mt-10 flex flex-col gap-9">{children}</div>
    </Container>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-[17px] font-semibold tracking-[-0.02em] text-mk-fg">
        {heading}
      </h2>
      <div className="flex flex-col gap-3 text-[13.5px] leading-relaxed text-mk-muted">
        {children}
      </div>
    </section>
  );
}
