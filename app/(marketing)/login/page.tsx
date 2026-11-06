import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";

import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { WaitlistForm } from "@/components/marketing/waitlist-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to the Wands terminal.",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <Container width="narrow" className="py-16 sm:py-24">
      <div className="flex flex-col gap-5">
        <Eyebrow>Terminal access</Eyebrow>
        <h1 className="font-display text-balance text-3xl font-semibold tracking-[-0.035em] text-mk-fg sm:text-4xl">
          The terminal is invite-only during the beta.
        </h1>
        <p className="text-pretty text-[14.5px] leading-relaxed text-mk-muted">
          Accounts are provisioned by invite while we onboard the first cohort.
          There is no public sign-up yet — join the waitlist and we will send
          credentials when your seat opens.
        </p>
      </div>

      <div className="mt-8 flex items-start gap-3 rounded-xl border border-mk-line bg-mk-surface p-4">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-mk-line-strong text-mk-muted">
          <LockKeyhole className="size-3.5" aria-hidden />
        </span>
        <p className="text-[12.5px] leading-relaxed text-mk-muted">
          Already have an invite? Use the sign-in link in the email we sent you.
          If it has expired, reply to that email and we will reissue it.
        </p>
      </div>

      <div className="mt-8 rounded-xl border border-mk-line bg-mk-surface p-5">
        <h2 className="text-[14px] font-medium text-mk-fg">Join the waitlist</h2>
        <p className="mt-1 mb-4 text-[12.5px] leading-relaxed text-mk-muted">
          One email when your seat opens. Nothing else.
        </p>
        <WaitlistForm source="login" />
      </div>

      <Link
        href="/"
        className="group mt-8 inline-flex items-center gap-1.5 text-[13px] text-mk-muted transition-colors hover:text-mk-fg"
      >
        Back to the site
        <ArrowRight
          className="size-3.5 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </Container>
  );
}
