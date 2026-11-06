import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Container } from "./container";
import { EditorialHeadline } from "./editorial";
import { Reveal } from "./reveal";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-mk-line bg-mk-deep">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(50%_100%_at_50%_0%,rgba(200,247,81,0.1),transparent_70%)]"
        aria-hidden
      />

      <Container width="wide" className="relative">
        <div className="flex flex-col items-center py-20 text-center sm:py-28">
          <Reveal variant="lines">
            <EditorialHeadline
              className="text-[clamp(2.3rem,8vw,6rem)] leading-[0.88]"
              lines={[
                "THERE'S MORE TO",
                "THE MARKET.",
                <span key="find" className="text-mk-accent">
                  GO FIND IT.
                </span>,
              ]}
            />
          </Reveal>

          <Reveal delay={180}>
            <p className="mx-auto mt-7 max-w-md text-pretty text-[14px] leading-relaxed text-mk-muted">
              Wands is building the tools to explore what lies beyond the price
              chart.
            </p>

            <div className="mt-8 flex flex-col items-center gap-3">
              <Link
                href="/#access"
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-mk-accent px-7 font-marketing-mono text-[11px] font-medium tracking-[0.14em] text-mk-accent-ink uppercase transition-colors hover:bg-mk-accent/90"
              >
                Get Early Access
                <ArrowUpRight
                  className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  aria-hidden
                />
              </Link>
              <p className="font-marketing-mono text-[9px] tracking-[0.16em] text-mk-dim uppercase">
                No card required · Invites sent in order
              </p>
            </div>
          </Reveal>
        </div>

      </Container>
    </section>
  );
}
