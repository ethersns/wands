import { Container } from "./container";
import { Eyebrow } from "./eyebrow";
import { WaitlistForm } from "./waitlist-form";

export function CtaBand({
  source = "landing",
  title = "See the evidence before you see the price.",
  description = "Join the private beta. We onboard in small cohorts so every account gets supported properly.",
}: {
  source?: string;
  title?: string;
  description?: string;
}) {
  return (
    <section id="access" className="scroll-mt-24 border-t border-mk-line">
      <Container>
        <div className="grid gap-10 py-16 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
          <div className="flex flex-col gap-4">
            <Eyebrow>Private beta</Eyebrow>
            <h2 className="font-display text-balance text-3xl font-semibold tracking-[-0.035em] text-mk-fg sm:text-4xl">
              {title}
            </h2>
            <p className="max-w-md text-pretty text-[15px] leading-relaxed text-mk-muted">
              {description}
            </p>
          </div>
          <div className="rounded-xl border border-mk-line bg-mk-surface p-5">
            <WaitlistForm source={source} />
          </div>
        </div>
      </Container>
    </section>
  );
}
