"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";

import { marketingNav, primaryCta } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

import { Container } from "./container";

function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Wands home"
      className={cn(
        "group inline-flex items-center gap-2.5 text-mk-fg transition-opacity hover:opacity-80",
        className,
      )}
    >
      <span
        className="size-1.5 bg-mk-accent transition-transform duration-300 group-hover:rotate-45"
        aria-hidden
      />
      <span className="font-editorial text-[15px] leading-none font-bold tracking-[0.24em]">
        WANDS
      </span>
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-colors duration-300",
        scrolled || open
          ? "border-b border-mk-line bg-mk-bg/85 backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <Container width="wide">
        <div className="flex h-16 items-center justify-between gap-6">
          <Wordmark />

          <nav aria-label="Main" className="hidden items-center gap-7 lg:flex">
            {marketingNav.map((item) => {
              const active =
                pathname === item.href ||
                (item.href.startsWith("/") &&
                  !item.href.includes("#") &&
                  pathname.startsWith(`${item.href}/`));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative font-marketing-mono text-[10.5px] tracking-[0.16em] uppercase transition-colors",
                    active ? "text-mk-fg" : "text-mk-muted hover:text-mk-fg",
                  )}
                >
                  {item.label}
                  <span
                    className={cn(
                      "absolute -bottom-1.5 left-0 h-px w-full origin-left bg-mk-accent transition-transform duration-300",
                      active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100",
                    )}
                    aria-hidden
                  />
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-1 lg:flex">
            <Link
              href="/login"
              className="rounded-md px-3 py-1.5 font-marketing-mono text-[10.5px] tracking-[0.14em] text-mk-muted uppercase transition-colors hover:text-mk-fg"
            >
              Sign in
            </Link>
            <Link
              href={primaryCta.href}
              className="group inline-flex h-9 items-center gap-1.5 rounded-full bg-mk-accent px-4 font-marketing-mono text-[10.5px] font-medium tracking-[0.12em] text-mk-accent-ink uppercase transition-colors hover:bg-mk-accent/90"
            >
              {primaryCta.label}
              <ArrowUpRight
                className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                aria-hidden
              />
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="inline-flex size-9 items-center justify-center rounded-md border border-mk-line-strong text-mk-fg lg:hidden"
          >
            {open ? (
              <X className="size-4" aria-hidden />
            ) : (
              <Menu className="size-4" aria-hidden />
            )}
          </button>
        </div>
      </Container>

      {open ? (
        <div
          id="mobile-nav"
          className="absolute inset-x-0 top-full z-40 h-[calc(100dvh-4rem)] overflow-y-auto border-t border-mk-line bg-mk-bg lg:hidden"
        >
          <Container width="wide">
            <nav aria-label="Mobile" className="flex flex-col py-6">
              {marketingNav.map((item, index) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="group flex items-baseline justify-between border-b border-mk-line py-4"
                >
                  <span className="font-editorial text-2xl font-semibold tracking-[-0.03em] text-mk-fg">
                    {item.label}
                  </span>
                  <span className="font-marketing-mono text-[10px] tracking-[0.16em] text-mk-dim">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </Link>
              ))}

              <div className="mt-6 flex flex-col gap-2">
                <Link
                  href={primaryCta.href}
                  onClick={() => setOpen(false)}
                  className="inline-flex h-12 items-center justify-center rounded-full bg-mk-accent font-marketing-mono text-[11px] font-medium tracking-[0.14em] text-mk-accent-ink uppercase"
                >
                  {primaryCta.label}
                </Link>
                <Link
                  href="/login"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-12 items-center justify-center rounded-full border border-mk-line-strong font-marketing-mono text-[11px] tracking-[0.14em] text-mk-fg uppercase"
                >
                  Sign in
                </Link>
              </div>
            </nav>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
