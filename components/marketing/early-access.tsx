import { Container } from "./container";
import { EditorialHeadline, SectionLabel } from "./editorial";
import { Reveal } from "./reveal";
import { WaitlistForm } from "./waitlist-form";

const steps = [
  {
    title: "Join the list",
    body: "One email address. No card, no questionnaire.",
  },
  {
    title: "We open seats in order",
    body: "Invites go out as the workspace is ready for more people.",
  },
  {
    title: "You get a workspace",
    body: "Filings, holdings and research in one place, evidence attached.",
  },
];

export function EarlyAccess() {
  return (
    <section
      id="access"
      className="relative scroll-mt-20 overflow-hidden border-t border-mk-line bg-mk-deep"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(50%_100%_at_50%_0%,rgba(200,247,81,0.1),transparent_70%)]"
        aria-hidden
      />
      <div
        className="mk-grid pointer-events-none absolute inset-0 opacity-25"
        aria-hidden
      />

      <Container width="wide" className="relative">
        <div className="grid gap-10 py-16 sm:py-24 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-16">
          <div>
            <Reveal>
              <SectionLabel>Early access</SectionLabel>
            </Reveal>
            <Reveal variant="lines" delay={60}>
              <EditorialHeadline
                className="mt-5 max-w-xl text-[clamp(1.9rem,4.6vw,3.25rem)] leading-[0.94]"
                lines={[
                  "BE EARLY TO A",
                  "DIFFERENT KIND OF",
                  <span key="mi" className="text-mk-accent">
                    MARKET INTELLIGENCE.
                  </span>,
                ]}
              />
            </Reveal>
            <Reveal delay={140}>
              <p className="mt-5 max-w-md text-pretty text-[14px] leading-relaxed text-mk-muted">
                Wands is being built for independent thinkers who want more than
                market noise. Join the early-access list and follow what&apos;s
                coming next.
              </p>
            </Reveal>
          </div>

          <Reveal delay={200}>
            <div className="rounded-xl border border-mk-line bg-mk-surface/60 p-6 sm:p-7">
              <p className="font-marketing-mono text-[9px] tracking-[0.2em] text-mk-dim uppercase">
                Join the early access list
              </p>
              <div className="mt-4">
                <WaitlistForm source="landing" />
              </div>
            </div>
          </Reveal>
        </div>

        <Reveal delay={120}>
          <ol className="grid gap-px overflow-hidden border-t border-mk-line sm:grid-cols-3">
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="flex gap-3.5 border-b border-mk-line py-5 sm:border-b-0 sm:border-r sm:pr-6 sm:last:border-r-0 sm:last:pr-0"
              >
                <span className="font-marketing-mono text-[9.5px] tracking-[0.14em] text-mk-accent tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-medium text-mk-fg">
                    {step.title}
                  </span>
                  <span className="text-[12px] leading-relaxed text-mk-muted">
                    {step.body}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </Reveal>
      </Container>
    </section>
  );
}
