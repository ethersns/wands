"use client";

import { useState } from "react";

const primaryButtonClass =
  "inline-flex items-center justify-center rounded-lg bg-mk-accent px-4 py-2.5 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60";

const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-lg border border-mk-line px-4 py-2.5 text-sm font-medium text-mk-fg transition-colors hover:border-mk-accent/40 disabled:opacity-60";

function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(url: string, body: unknown, fallback: string) {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;

      if (!response.ok || !payload?.url) {
        setPending(false);
        setError(payload?.error ?? fallback);
        return;
      }

      window.location.assign(payload.url);
    } catch {
      setPending(false);
      setError(fallback);
    }
  }

  return { pending, error, run };
}

function ActionError({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className="mt-3 rounded-lg border border-mk-warn/30 bg-mk-warn/10 px-3 py-2 text-[13px] leading-relaxed text-mk-warn"
    >
      {message}
    </p>
  );
}

/**
 * Opens the Stripe customer portal.
 *
 * The request carries no customer id. The server reads it from the signed-in
 * member's own membership row, so this button can only ever open the portal of
 * the person clicking it.
 */
export function BillingPortalButton({ label }: { label?: string }) {
  const { pending, error, run } = useAction();

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          run("/api/billing/portal", {}, "The billing portal could not be opened.")
        }
        className={secondaryButtonClass}
      >
        {pending ? "Opening portal" : (label ?? "Open billing portal")}
      </button>
      <ActionError message={error} />
    </div>
  );
}

/**
 * Starts a membership for an account that is already signed in.
 *
 * The email is not sent: the server uses the session's address, so a member
 * cannot start a checkout for an address that is not theirs.
 */
export function StartMembershipButton({ label }: { label?: string }) {
  const { pending, error, run } = useAction();

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          run(
            "/api/billing/checkout",
            { plan: "founding", termsAccepted: true },
            "Checkout could not be started.",
          )
        }
        className={primaryButtonClass}
      >
        {pending ? "Opening secure checkout" : (label ?? "Continue to Secure Checkout")}
      </button>
      <ActionError message={error} />
    </div>
  );
}
