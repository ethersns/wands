import { Container } from "./container";
import { EditorialHeadline, SectionLabel } from "./editorial";
import { Reveal } from "./reveal";
import { WaitlistForm } from "./waitlist-form";

const steps = [
  {
    title: "Join the list",
    body: "One email address. No card, no questionnaire you have to fight through.",
  },
  {
    title: "We open seats in order",
    body: "Invites go out as the workspace is ready for more people, oldest first.",
  },
  {
    title: "You get a workspace",
    body: "Filings, holdings and signals in one place, with the evidence attached.",
  },
];

export function WaitlistPanel() {
  return (
    <section
      id="access"
      className="relative scroll-mt-20 overflow-hidden border-t border-mk-line py-16 sm:py-24"
    >
      <div
        className="mk-grid pointer-events-none absolute inset-0 opacity-30"
        aria-hidden
      />
      <Container width="wide" className="relative">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16">
          <div>
            <Reveal>
              <SectionLabel>Early access</SectionLabel>
            </Reveal>
            <Reveal variant="lines" delay={60}>
              <EditorialHeadline
                className="mt-5 max-w-xl text-[clamp(1.9rem,4.6vw,3.25rem)] leading-[0.94]"
                lines={[
                  "YOUR NEXT RESEARCH",
                  "WORKSPACE IS",
                  <span key="t" className="text-mk-accent">
                    TAKING SHAPE.
                  </span>,
                ]}
              />
            </Reveal>
            <Reveal delay={140}>
              <p className="mt-5 max-w-md text-pretty text-[14px] leading-relaxed text-mk-muted">
                Get on the list for launch news, early access opportunities and a
                first look at what&apos;s coming to Wands.
              </p>
              <div className="mt-7 max-w-lg">
                <WaitlistForm source="landing" />
              </div>
            </Reveal>
          </div>

          <Reveal delay={200}>
            <div className="rounded-xl border border-mk-line bg-mk-surface/60 p-6">
              <p className="font-marketing-mono text-[9px] tracking-[0.2em] text-mk-dim uppercase">
                What happens next
              </p>
              <ol className="mt-5 flex flex-col">
                {steps.map((step, index) => (
                  <li
                    key={step.title}
                    className="flex gap-3.5 border-t border-mk-line py-4 first:border-0 first:pt-0 last:pb-0"
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
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
