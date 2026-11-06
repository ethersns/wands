"use client";

import { useId, useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

type Status = "idle" | "submitting" | "success" | "error";

const roles = [
  "Self-directed trader",
  "Fund or prop desk",
  "Researcher or analyst",
  "Just exploring",
];

export function WaitlistForm({
  className,
  source = "landing",
}: {
  className?: string;
  source?: string;
}) {
  const emailId = useId();
  const roleId = useId();
  const statusId = useId();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;

    const form = event.currentTarget;
    const honeypot = new FormData(form).get("company_website");

    setStatus("submitting");
    setMessage(null);

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          role: role || null,
          source,
          companyWebsite: typeof honeypot === "string" ? honeypot : "",
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setStatus("error");
        setMessage(
          payload?.error ??
            "We could not save that just now. Please try again in a moment.",
        );
        return;
      }

      setStatus("success");
      setMessage(payload.message ?? "You are on the list.");
      setEmail("");
      setRole("");
    } catch {
      setStatus("error");
      setMessage("Network error. Please check your connection and try again.");
    }
  }

  if (status === "success") {
    return (
      <div
        className={cn(
          "flex items-start gap-3 rounded-xl border border-mk-accent/25 bg-mk-accent-soft p-4",
          className,
        )}
        role="status"
      >
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-mk-accent text-mk-accent-ink">
          <Check className="size-3.5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-[14px] font-medium text-mk-fg">
            You are on the list.
          </p>
          <p className="text-[13px] leading-relaxed text-mk-muted">
            {message} We review the waitlist weekly and send invites in order.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("flex flex-col gap-3", className)}
      noValidate
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1">
          <label htmlFor={emailId} className="sr-only">
            Email address
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-describedby={statusId}
            aria-invalid={status === "error" ? true : undefined}
            className="h-11 w-full rounded-lg border border-mk-line-strong bg-mk-raised/60 px-3.5 text-[14px] text-mk-fg placeholder:text-mk-dim focus:border-mk-accent/50 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={status === "submitting"}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-mk-accent px-5 text-[14px] font-medium text-mk-accent-ink transition-colors hover:bg-mk-accent/90 disabled:opacity-60"
        >
          {status === "submitting" ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Joining
            </>
          ) : (
            <>
              Request access
              <ArrowRight className="size-4" aria-hidden />
            </>
          )}
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label
          htmlFor={roleId}
          className="font-marketing-mono text-[10px] tracking-[0.12em] text-mk-dim uppercase"
        >
          What do you trade
        </label>
        <select
          id={roleId}
          name="role"
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className="h-9 rounded-md border border-mk-line bg-mk-raised/40 px-2 text-[12.5px] text-mk-muted focus:border-mk-accent/50 focus:outline-none"
        >
          <option value="">Prefer not to say</option>
          {roles.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className="hidden" aria-hidden>
        <label htmlFor={`${emailId}-company`}>Company website</label>
        <input
          id={`${emailId}-company`}
          name="company_website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <p
        id={statusId}
        aria-live="polite"
        className={cn(
          "min-h-4 text-[12px] leading-relaxed",
          status === "error" ? "text-mk-warn" : "text-mk-dim",
        )}
      >
        {status === "error"
          ? message
          : "No card required. One email when your seat opens, nothing else."}
      </p>
    </form>
  );
}
