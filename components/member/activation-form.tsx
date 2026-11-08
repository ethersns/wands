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
 * Sets the password that turns a paid signup into an account.
 *
 * Two modes, because the two cases are genuinely different. A new customer
 * chooses a password here. An existing account is only attached after the
 * caller has signed into it, so the emailed link alone can never be used to
 * take over an account someone else already owns.
 */
export function ActivationForm({
  token,
  mode,
  email,
}: {
  token: string;
  mode: "create" | "attach";
  email: string;
}) {
  const nameId = useId();
  const passwordId = useId();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (mode === "create" && password.length < 10) {
      setError("Use at least 10 characters for your password.");
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/billing/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          ...(mode === "create" ? { password, name } : {}),
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        redirect?: string;
        error?: string;
        code?: string;
      } | null;

      if (response.status === 401 && payload?.code === "sign_in_required") {
        setPending(false);
        setNeedsSignIn(true);
        return;
      }

      if (!response.ok || !payload?.ok) {
        setPending(false);
        setError(payload?.error ?? "Activation could not be completed.");
        return;
      }

      window.location.assign(payload.redirect ?? "/signin?activated=1");
    } catch {
      setPending(false);
      setError("Activation could not be completed. Check your connection and try again.");
    }
  }

  if (needsSignIn) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-mk-muted">
          This email already has a Wands account. Sign in to attach the membership
          to it — your saved research stays exactly where it is.
        </p>
        <Link
          href={`/signin?next=${encodeURIComponent(`/activate?token=${token}`)}`}
          className={primaryButtonClass}
        >
          Sign in to continue
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-mk-warn/30 bg-mk-warn/10 px-3 py-2 text-[13px] leading-relaxed text-mk-warn"
        >
          {error}
        </p>
      ) : null}

      {mode === "create" ? (
        <>
          <div>
            <label htmlFor={nameId} className={labelClass}>
              Name <span className="normal-case tracking-normal text-mk-dim">(optional)</span>
            </label>
            <input
              id={nameId}
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
              placeholder="Alex Mercer"
            />
          </div>

          <div>
            <label htmlFor={passwordId} className={labelClass}>
              Choose a password
            </label>
            <input
              id={passwordId}
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
              aria-describedby={`${passwordId}-hint`}
            />
            <p id={`${passwordId}-hint`} className="mt-1.5 text-xs text-mk-dim">
              At least 10 characters. You will sign in with {email}.
            </p>
          </div>
        </>
      ) : (
        <p className="text-sm leading-relaxed text-mk-muted">
          You are signed in as {email}. Activating attaches the paid membership to
          this account and keeps everything already saved in it.
        </p>
      )}

      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending
          ? "Activating"
          : mode === "create"
            ? "Activate my account"
            : "Activate membership"}
      </button>
    </form>
  );
}
