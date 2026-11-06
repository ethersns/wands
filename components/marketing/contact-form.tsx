"use client";

import { useId, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

type Status = "idle" | "submitting" | "success" | "error";

const topics = [
  "Access and waitlist",
  "Data and coverage",
  "Security review",
  "Billing",
  "Something else",
];

const fieldClass =
  "h-10 w-full rounded-lg border border-mk-line-strong bg-mk-raised/60 px-3 text-[13.5px] text-mk-fg placeholder:text-mk-dim focus:border-mk-accent/50 focus:outline-none";

export function ContactForm() {
  const nameId = useId();
  const emailId = useId();
  const topicId = useId();
  const messageId = useId();
  const statusId = useId();

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;

    const form = event.currentTarget;
    const data = new FormData(form);

    setStatus("submitting");
    setMessage(null);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          email: String(data.get("email") ?? ""),
          topic: String(data.get("topic") ?? ""),
          message: String(data.get("message") ?? ""),
          companyWebsite: String(data.get("company_website") ?? ""),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setStatus("error");
        setMessage(
          payload?.error ?? "We could not send that. Please try again shortly.",
        );
        return;
      }

      setStatus("success");
      form.reset();
    } catch {
      setStatus("error");
      setMessage("Network error. Please check your connection and try again.");
    }
  }

  if (status === "success") {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-xl border border-mk-accent/25 bg-mk-accent-soft p-4"
      >
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-mk-accent text-mk-accent-ink">
          <Check className="size-3.5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-[14px] font-medium text-mk-fg">Message received.</p>
          <p className="text-[13px] leading-relaxed text-mk-muted">
            We read every message and reply from a monitored inbox, usually
            within two business days.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={nameId}
            className="font-marketing-mono text-[10px] tracking-[0.12em] text-mk-dim uppercase"
          >
            Name
          </label>
          <input
            id={nameId}
            name="name"
            type="text"
            required
            autoComplete="name"
            className={fieldClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={emailId}
            className="font-marketing-mono text-[10px] tracking-[0.12em] text-mk-dim uppercase"
          >
            Email
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            required
            autoComplete="email"
            className={fieldClass}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={topicId}
          className="font-marketing-mono text-[10px] tracking-[0.12em] text-mk-dim uppercase"
        >
          Topic
        </label>
        <select id={topicId} name="topic" className={fieldClass} defaultValue={topics[0]}>
          {topics.map((topic) => (
            <option key={topic} value={topic}>
              {topic}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={messageId}
          className="font-marketing-mono text-[10px] tracking-[0.12em] text-mk-dim uppercase"
        >
          Message
        </label>
        <textarea
          id={messageId}
          name="message"
          required
          rows={5}
          className="w-full resize-y rounded-lg border border-mk-line-strong bg-mk-raised/60 px-3 py-2.5 text-[13.5px] leading-relaxed text-mk-fg placeholder:text-mk-dim focus:border-mk-accent/50 focus:outline-none"
        />
      </div>

      <div className="hidden" aria-hidden>
        <label htmlFor={`${nameId}-company`}>Company website</label>
        <input
          id={`${nameId}-company`}
          name="company_website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="submit"
          disabled={status === "submitting"}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-mk-accent px-5 text-[13.5px] font-medium text-mk-accent-ink transition-colors hover:bg-mk-accent/90 disabled:opacity-60"
        >
          {status === "submitting" ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Sending
            </>
          ) : (
            "Send message"
          )}
        </button>
        <p
          id={statusId}
          aria-live="polite"
          className={cn(
            "text-[12px] leading-relaxed",
            status === "error" ? "text-mk-warn" : "text-mk-dim",
          )}
        >
          {status === "error"
            ? message
            : "We never share your details. See the privacy policy."}
        </p>
      </div>
    </form>
  );
}
