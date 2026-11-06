import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";

import { checkoutAvailableFor } from "@/lib/billing/config";

import { Container } from "./container";
import { EditorialHeadline, SectionLabel } from "./editorial";
import { Reveal } from "./reveal";

const included = [
  { label: "Intelligence overview with filing-level provenance", ready: true },
  { label: "Insider Radar — Form 4 transactions and clusters", ready: true },
  { label: "Institutional Radar — 13F holdings and changes", ready: true },
  { label: "Data coverage and freshness reporting", ready: true },
  { label: "Research performance workspace", ready: false },
  { label: "Strategy Lab with out-of-sample runs", ready: false },
];

export function FoundingAccess() {
  const checkoutAvailable = checkoutAvailableFor("operator");

  return (
    <section
      id="founding"
      className="relative scroll-mt-20 overflow-hidden border-t border-mk-line bg-mk-deep py-16 sm:py-24"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(45%_100%_at_20%_0%,rgba(200,247,81,0.08),transparent_70%)]"
        aria-hidden
      />

      <Container width="wide" className="relative">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <Reveal>
              <SectionLabel index="Pricing">Founding membership</SectionLabel>
            </Reveal>
            <Reveal variant="lines" delay={60}>
              <EditorialHeadline
                className="mt-5 max-w-2xl text-[clamp(2rem,5vw,3.75rem)] leading-[0.92]"
                lines={["BE THERE FROM", "THE BEGINNING."]}
              />
            </Reveal>
          </div>
          <Reveal delay={140}>
            <p className="max-w-sm text-pretty text-[13.5px] leading-relaxed text-mk-muted lg:pb-2">
              Wands is building a new home for independent market research. Join
              early, explore what&apos;s being built and help shape what comes
              next.
            </p>
          </Reveal>
        </div>

        <Reveal delay={120} className="mt-10">
          <div className="grid overflow-hidden rounded-xl border border-mk-line-strong bg-mk-surface lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <div className="p-6 sm:p-8">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-marketing-mono text-[9.5px] tracking-[0.2em] text-mk-accent uppercase">
                  Wands Founding Access
                </span>
                <span className="rounded-full border border-mk-line-strong px-2 py-0.5 font-marketing-mono text-[8.5px] tracking-[0.12em] text-mk-dim uppercase">
                  Proposed price
                </span>
              </div>

              <div className="mt-5 flex items-end gap-2">
                <span className="font-editorial text-[clamp(3rem,7vw,4.5rem)] leading-none font-semibold tracking-[-0.05em] text-mk-fg">
                  $19
                </span>
                <span className="pb-2 font-marketing-mono text-[10.5px] tracking-[0.12em] text-mk-dim uppercase">
                  / month
                </span>
              </div>

              <p className="mt-3 max-w-md text-[13.5px] leading-relaxed text-mk-muted">
                Your place inside the Wands research workspace. Billing is not
                live — nothing is charged today, and the founding list costs
                nothing to join.
              </p>

              <ul className="mt-6 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                {included.map((item) => (
                  <li key={item.label} className="flex items-start gap-2">
                    <Check
                      className={
                        item.ready
                          ? "mt-0.5 size-3.5 shrink-0 text-mk-accent"
                          : "mt-0.5 size-3.5 shrink-0 text-mk-dim"
                      }
                      aria-hidden
                    />
                    <span className="text-[12.5px] leading-snug text-mk-muted">
                      {item.label}
                      {item.ready ? null : (
                        <span className="mt-0.5 block font-marketing-mono text-[8px] tracking-[0.12em] text-mk-dim uppercase">
                          In development
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <Link
                  href={checkoutAvailable ? "/pricing" : "/#access"}
                  className="group inline-flex h-11 items-center justify-center gap-2 rounded-full bg-mk-accent px-5 font-marketing-mono text-[10.5px] font-medium tracking-[0.14em] text-mk-accent-ink uppercase transition-colors hover:bg-mk-accent/90"
                >
                  {checkoutAvailable
                    ? "Become a Founding Member"
                    : "Join the Founding List"}
                  <ArrowUpRight
                    className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    aria-hidden
                  />
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex h-11 items-center justify-center rounded-full border border-mk-line-strong px-5 font-marketing-mono text-[10.5px] tracking-[0.14em] text-mk-fg uppercase transition-colors hover:bg-mk-raised/60"
                >
                  Compare plans
                </Link>
              </div>
            </div>

            <div className="relative flex flex-col justify-between gap-6 border-t border-mk-line bg-mk-deep p-6 sm:p-8 lg:border-t-0 lg:border-l">
              <div>
                <p className="font-marketing-mono text-[9px] tracking-[0.2em] text-mk-dim uppercase">
                  Founding member
                </p>
                <div className="mt-4 rounded-lg border border-mk-line-strong bg-mk-surface p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-editorial text-[12px] font-bold tracking-[0.22em] text-mk-fg">
                      WANDS
                    </span>
                    <span className="size-1.5 bg-mk-accent" aria-hidden />
                  </div>
                  <p className="mt-6 font-marketing-mono text-[9px] tracking-[0.16em] text-mk-dim uppercase">
                    Early access
                  </p>
                  <p className="mt-1 font-editorial text-[15px] font-semibold tracking-[-0.02em] text-mk-fg">
                    Research workspace
                  </p>
                  <div className="mt-4 flex items-center justify-between border-t border-mk-line pt-3">
                    <span className="font-marketing-mono text-[8.5px] tracking-[0.14em] text-mk-dim uppercase">
                      Private beta
                    </span>
                    <span className="font-marketing-mono text-[8.5px] tracking-[0.14em] text-mk-accent uppercase">
                      Founding
                    </span>
                  </div>
                </div>
              </div>

              <ul className="flex flex-col gap-2.5">
                {[
                  "Early access to the workspace",
                  "Founding-member identity in the product",
                  "Roadmap input while the platform is being built",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-[12px] leading-snug text-mk-muted"
                  >
                    <span
                      className="mt-1.5 size-1 shrink-0 bg-mk-accent"
                      aria-hidden
                    />
                    {item}
                  </li>
                ))}
              </ul>

              <p className="text-[10.5px] leading-relaxed text-mk-dim">
                No countdowns, no invented scarcity. Seats open as the platform
                is ready for them.
              </p>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
