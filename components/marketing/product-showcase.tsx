import { cn } from "@/lib/utils";

import { ButtonLink } from "./button-link";
import { Eyebrow } from "./eyebrow";

export function ProductShowcase({
  eyebrow,
  title,
  description,
  visual,
  highlights,
  footnote,
  cta,
  className,
}: {
  eyebrow: string;
  title: string;
  description: string;
  visual: React.ReactNode;
  highlights: { title: string; body: string }[];
  footnote: string;
  cta?: { href: string; label: string };
  className?: string;
}) {
  return (
    <section className={cn("py-16 sm:py-20", className)}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex max-w-2xl flex-col gap-4">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="font-display text-balance text-3xl font-semibold tracking-[-0.035em] text-mk-fg sm:text-4xl lg:text-[2.5rem] lg:leading-[1.06]">
            {title}
          </h2>
          <p className="text-pretty text-[15px] leading-relaxed text-mk-muted sm:text-base">
            {description}
          </p>
        </div>
        {cta ? (
          <ButtonLink
            href={cta.href}
            variant="secondary"
            size="md"
            className="shrink-0"
          >
            {cta.label}
          </ButtonLink>
        ) : null}
      </div>

      <div className="mt-10">{visual}</div>

      <div className="mt-8 grid gap-x-8 gap-y-6 border-t border-mk-line pt-8 sm:grid-cols-3">
        {highlights.map((highlight) => (
          <div key={highlight.title} className="flex flex-col gap-1.5">
            <h3 className="text-[13.5px] font-medium text-mk-fg">
              {highlight.title}
            </h3>
            <p className="text-[13px] leading-relaxed text-mk-muted">
              {highlight.body}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-6 font-marketing-mono text-[10px] tracking-[0.1em] text-mk-dim uppercase">
        {footnote}
      </p>
    </section>
  );
}
