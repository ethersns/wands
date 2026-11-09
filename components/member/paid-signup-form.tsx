"use client";

import Link from "next/link";
import { useId, useState } from "react";

const inputClass =
  "w-full rounded-lg border border-mk-line bg-mk-bg px-3 py-2.5 text-sm text-mk-fg placeholder:text-mk-dim focus:border-mk-accent/60 focus:outline-none focus:ring-2 focus:ring-mk-accent/20";

const labelClass =
  "mb-1.5 block font-marketing-mono text-[11px] uppercase tracking-[0.14em] text-mk-muted";

const primaryButtonClass =
  "inline-flex w-full items-center justify-center rounded-lg bg-mk-accent px-4 py-2.5 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60";

/**
 * The paid signup form.
 *
 * There is no password field and no account is created here. The only thing
 * this form does is start a Stripe Checkout session for an email address; the
 * account itself is created after Stripe confirms the payment and the customer
 * proves they control that address. That ordering is the whole point — a
 * visitor cannot end up with a usable account by filling in a form.
 */
export function PaidSignupForm({
  planName,
  priceLabel,
  priceConfirmed,
  checkoutAvailable,
  blockedReason,
  cancelled,
}: {
  planName: string;
  priceLabel: string;
  priceConfirmed: boolean;
  checkoutAvailable: boolean;
  blockedReason: string | null;
  cancelled: boolean;
}) {
  const emailId = useId();
  const termsId = useId();
  const [email, setEmail] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!accepted) {
      setError("Accept the subscription terms to continue.");
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, plan: "founding", termsAccepted: true }),
      });

      const payload = (await response.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;

      if (!response.ok || !payload?.url) {
        setPending(false);
        setError(
          payload?.error ?? "Checkout could not be started. Try again in a moment.",
        );
        return;
      }

      window.location.assign(payload.url);
    } catch {
      setPending(false);
      setError("Checkout could not be started. Check your connection and try again.");
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-mk-fg">
            {planName}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-mk-muted">
            Billed monthly. Renews automatically until cancelled.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={
              priceConfirmed
                ? "font-display text-2xl font-semibold tracking-[-0.03em] text-mk-fg"
                : "font-display text-sm font-semibold tracking-[-0.01em] text-mk-fg"
            }
          >
            {priceLabel}
          </p>
          {!priceConfirmed ? (
            <p className="mt-1 font-marketing-mono text-[9.5px] uppercase tracking-[0.12em] text-mk-dim">
              Not yet confirmed
            </p>
          ) : null}
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 border-y border-mk-line py-4">
        <div>
          <dt className="font-marketing-mono text-[9.5px] uppercase tracking-[0.12em] text-mk-dim">
            Billing interval
          </dt>
          <dd className="mt-1 text-[13px] text-mk-fg">Every month</dd>
        </div>
        <div>
          <dt className="font-marketing-mono text-[9.5px] uppercase tracking-[0.12em] text-mk-dim">
            Free trial
          </dt>
          <dd className="mt-1 text-[13px] text-mk-fg">None</dd>
        </div>
        <div>
          <dt className="font-marketing-mono text-[9.5px] uppercase tracking-[0.12em] text-mk-dim">
            Renewal
          </dt>
          <dd className="mt-1 text-[13px] text-mk-fg">Automatic, monthly</dd>
        </div>
        <div>
          <dt className="font-marketing-mono text-[9.5px] uppercase tracking-[0.12em] text-mk-dim">
            Cancellation
          </dt>
          <dd className="mt-1 text-[13px] text-mk-fg">Access to period end</dd>
        </div>
      </dl>

      {cancelled ? (
        <p
          role="status"
          className="mt-4 rounded-lg border border-mk-line bg-mk-deep/40 px-3 py-2 text-[13px] leading-relaxed text-mk-muted"
        >
          Checkout was cancelled. Nothing has been charged and no account was
          created.
        </p>
      ) : null}

      {!checkoutAvailable ? (
        <div className="mt-5 flex flex-col gap-3">
          <p className="rounded-lg border border-mk-warn/30 bg-mk-warn/10 px-3 py-2.5 text-[13px] leading-relaxed text-mk-warn">
            {blockedReason ?? "Billing is not open yet."}
          </p>
          <p className="text-[13px] leading-relaxed text-mk-muted text-pretty">
            No account is created and no card is taken until billing opens. Join
            the waitlist and we will email you before anything is charged.
          </p>
          <Link
            href="/#access"
            className="inline-flex w-full items-center justify-center rounded-lg border border-mk-line px-4 py-2.5 text-sm font-medium text-mk-fg transition-colors hover:border-mk-accent/40"
          >
            Join the waitlist
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4" noValidate>
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-mk-warn/30 bg-mk-warn/10 px-3 py-2 text-[13px] leading-relaxed text-mk-warn"
            >
              {error}
            </p>
          ) : null}

          <div>
            <label htmlFor={emailId} className={labelClass}>
              Email address
            </label>
            <input
              id={emailId}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
              placeholder="you@example.com"
              aria-describedby={`${emailId}-hint`}
            />
            <p id={`${emailId}-hint`} className="mt-1.5 text-xs leading-relaxed text-mk-dim">
              Your activation link is sent here after payment. Use an address you
              control.
            </p>
          </div>

          <div className="flex items-start gap-2.5">
            <input
              id={termsId}
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 rounded border-mk-line bg-mk-bg accent-mk-accent"
            />
            <label htmlFor={termsId} className="text-[12.5px] leading-relaxed text-mk-muted">
              I agree to the{" "}
              <Link href="/terms" className="text-mk-accent underline-offset-4 hover:underline">
                terms of service
              </Link>{" "}
              and understand this is a recurring monthly subscription with no free
              trial.
            </label>
          </div>

          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? "Opening secure checkout" : "Continue to Secure Checkout"}
          </button>

          <p className="text-center text-[11.5px] leading-relaxed text-mk-dim text-pretty">
            Secure billing through Stripe. Cancel according to the subscription
            terms shown at checkout.
          </p>
        </form>
      )}

      <p className="mt-5 border-t border-mk-line pt-4 text-center text-[13px] text-mk-muted">
        Already a member?{" "}
        <Link href="/signin" className="text-mk-accent underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
