import { Container } from "./container";
import { EditorialHeadline, SectionLabel } from "./editorial";
import { Reveal } from "./reveal";

export function Manifesto() {
  return (
    <section className="relative overflow-hidden border-t border-mk-line py-20 sm:py-28">
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-mk-accent/40 to-transparent"
        aria-hidden
      />
      <Container width="wide">
        <Reveal>
          <SectionLabel>Manifesto</SectionLabel>
        </Reveal>

        <Reveal variant="lines" delay={80}>
          <EditorialHeadline
            className="mt-8 text-[clamp(1.85rem,6.2vw,4.5rem)] leading-[1.04]"
            lines={[
              "WE DON'T NEED MORE NOISE.",
              <span key="q" className="text-mk-muted">
                WE NEED BETTER QUESTIONS.
              </span>,
              <span key="e" className="text-mk-muted">
                BETTER EVIDENCE.
              </span>,
              <span key="t" className="text-mk-muted">
                BETTER TOOLS.
              </span>,
              <span key="w" className="text-mk-accent">
                WELCOME TO WANDS.
              </span>,
            ]}
          />
        </Reveal>

        <Reveal delay={200}>
          <p className="mt-10 max-w-md text-[13px] leading-relaxed text-mk-dim">
            A research platform is only as good as the questions it lets you ask.
            Wands is being built to make the evidence easier to reach than the
            opinion.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
