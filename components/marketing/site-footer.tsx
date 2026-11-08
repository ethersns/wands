import Link from "next/link";

import { contactEmail, footerNav, siteTagline } from "@/lib/marketing/site";

import { Container } from "./container";

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-mk-line bg-mk-deep">
      <div
        className="pointer-events-none absolute inset-x-0 -bottom-40 h-80 bg-[radial-gradient(60%_100%_at_50%_100%,rgba(200,247,81,0.09),transparent_70%)]"
        aria-hidden
      />

      <Container width="wide" className="relative">
        <div className="grid gap-10 py-14 lg:grid-cols-[1.4fr_2fr] lg:gap-16">
          <div className="flex flex-col gap-5">
            <p className="max-w-xs text-pretty text-[13.5px] leading-relaxed text-mk-muted">
              {siteTagline}. Built on primary sources, with the provenance of
              every figure kept intact.
            </p>
            {contactEmail ? (
              <a
                href={`mailto:${contactEmail}`}
                className="w-fit font-marketing-mono text-[11px] tracking-[0.1em] text-mk-fg underline decoration-mk-line-strong underline-offset-4 transition-colors hover:decoration-mk-accent"
              >
                {contactEmail}
              </a>
            ) : (
              <Link
                href="/contact"
                className="w-fit font-marketing-mono text-[11px] tracking-[0.1em] text-mk-fg underline decoration-mk-line-strong underline-offset-4 transition-colors hover:decoration-mk-accent"
              >
                Contact the team
              </Link>
            )}
            <p className="font-marketing-mono text-[9.5px] leading-relaxed tracking-[0.1em] text-mk-dim uppercase">
              Paid membership · Billed monthly
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {footerNav.map((group) => (
              <nav key={group.title} aria-label={group.title}>
                <h2 className="font-marketing-mono text-[9px] tracking-[0.18em] text-mk-dim uppercase">
                  {group.title}
                </h2>
                <ul className="mt-3.5 flex flex-col gap-2.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="text-[13px] text-mk-muted transition-colors hover:text-mk-fg"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="border-t border-mk-line pt-8 pb-10">
          <p
            className="font-editorial text-[clamp(3rem,13vw,8.5rem)] leading-[0.8] font-bold tracking-[-0.05em] text-mk-fg/90 select-none"
            aria-hidden
          >
            WANDS<span className="text-mk-accent">.</span>
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-mk-line py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-marketing-mono text-[9.5px] tracking-[0.1em] text-mk-dim uppercase">
            © {new Date().getFullYear()} Wands · All rights reserved
          </p>
          <p className="max-w-xl text-[11px] leading-relaxed text-mk-dim">
            Wands is a research tool. It is not investment advice, and nothing on
            this site is a recommendation to buy or sell a security.
          </p>
        </div>
      </Container>
    </footer>
  );
}
