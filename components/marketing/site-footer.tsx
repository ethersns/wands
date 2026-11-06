import Link from "next/link";

import { footerNav, siteName } from "@/lib/marketing/site";

import { Container } from "./container";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-mk-line bg-mk-deep">
      <Container>
        <div className="grid gap-10 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="flex flex-col gap-4">
            <Logo />
            <p className="max-w-xs text-[13px] leading-relaxed text-mk-muted">
              Market intelligence for people who trade on evidence. Filings,
              holdings and market data in one terminal.
            </p>
            <p className="font-marketing-mono text-[10px] tracking-[0.12em] text-mk-dim uppercase">
              Private beta
            </p>
          </div>

          {footerNav.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="font-marketing-mono text-[10px] tracking-[0.14em] text-mk-dim uppercase">
                {group.title}
              </h2>
              <ul className="mt-3 flex flex-col gap-2">
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

        <div className="flex flex-col gap-4 border-t border-mk-line py-6">
          <p className="max-w-3xl text-[11.5px] leading-relaxed text-mk-dim">
            {siteName} is software for research and order management. It is not a
            broker, dealer, investment adviser or fiduciary, and nothing on this
            site is investment advice or a recommendation to buy or sell any
            security. Trading involves substantial risk of loss and past
            performance does not indicate future results. Figures shown on this
            site are illustrative demonstration data.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-marketing-mono text-[10.5px] tracking-[0.08em] text-mk-dim uppercase">
              © {new Date().getFullYear()} {siteName}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-marketing-mono text-[10.5px] tracking-[0.08em] text-mk-dim uppercase">
              <Link href="/terms" className="hover:text-mk-muted">
                Terms
              </Link>
              <Link href="/privacy" className="hover:text-mk-muted">
                Privacy
              </Link>
              <Link href="/risk-disclosure" className="hover:text-mk-muted">
                Risk disclosure
              </Link>
            </div>
          </div>
        </div>
      </Container>
    </footer>
  );
}
