"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import type { NotificationPrefs } from "@/lib/member/notifications";
import { sendJson } from "@/lib/member/fetcher";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-lg border border-mk-line bg-mk-surface px-3 py-2 text-sm text-mk-fg placeholder:text-mk-dim focus:border-mk-accent/60 focus:outline-none focus:ring-2 focus:ring-mk-accent/20";

function Status({ message, tone }: { message: string | null; tone: "ok" | "error" }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        tone === "ok"
          ? "border-mk-emerald/30 bg-mk-emerald/10 text-mk-emerald"
          : "border-mk-warn/30 bg-mk-warn/10 text-mk-warn",
      )}
    >
      {message}
    </p>
  );
}

export function ProfileForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const nameId = useId();
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ message: string; tone: "ok" | "error" } | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setStatus(null);

    try {
      await sendJson("/api/member/account", "PATCH", { displayName: name.trim() });
      setStatus({ message: "Profile updated.", tone: "ok" });
      router.refresh();
    } catch (caught) {
      setStatus({ message: caught instanceof Error ? caught.message : "Could not save.", tone: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Status message={status?.message ?? null} tone={status?.tone ?? "ok"} />
      <div>
        <label htmlFor={nameId} className="mb-1.5 block font-marketing-mono text-[11px] uppercase tracking-[0.14em] text-mk-muted">
          Display name
        </label>
        <input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          required
          className={inputClass}
        />
      </div>
      <div>
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="rounded-lg bg-mk-accent px-3 py-2 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving" : "Save profile"}
        </button>
      </div>
    </form>
  );
}

const PREF_LABELS: Array<{ key: keyof NotificationPrefs; label: string; description: string }> = [
  { key: "insiderActivity", label: "Insider activity", description: "Open-market buys and sells on tickers you track." },
  { key: "institutionalFilings", label: "Institutional filings", description: "13F position changes for tracked names." },
  { key: "assetSignals", label: "Asset signals", description: "New signals published for your watchlists." },
  { key: "productUpdates", label: "Product updates", description: "Occasional notes about changes to Wands." },
];

export function PreferencesForm({ initial }: { initial: NotificationPrefs }) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(initial);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ message: string; tone: "ok" | "error" } | null>(null);

  async function toggle(key: keyof NotificationPrefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setPending(true);
    setStatus(null);

    try {
      await sendJson("/api/member/preferences", "PATCH", next);
      setStatus({ message: "Preferences saved.", tone: "ok" });
    } catch (caught) {
      setPrefs(prefs);
      setStatus({ message: caught instanceof Error ? caught.message : "Could not save.", tone: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Status message={status?.message ?? null} tone={status?.tone ?? "ok"} />
      <ul className="flex flex-col divide-y divide-mk-line">
        {PREF_LABELS.map((entry) => {
          const id = `pref-${entry.key}`;
          return (
            <li key={entry.key} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <label htmlFor={id} className="text-sm text-mk-fg">
                  {entry.label}
                </label>
                <p className="mt-0.5 text-xs leading-relaxed text-mk-muted text-pretty">{entry.description}</p>
              </div>
              <button
                id={id}
                type="button"
                role="switch"
                aria-checked={prefs[entry.key]}
                aria-label={entry.label}
                disabled={pending}
                onClick={() => toggle(entry.key)}
                className={cn(
                  "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60",
                  prefs[entry.key] ? "border-mk-accent/50 bg-mk-accent/30" : "border-mk-line bg-mk-raised",
                )}
              >
                <span
                  className={cn(
                    "block size-3.5 rounded-full transition-transform",
                    prefs[entry.key] ? "translate-x-[18px] bg-mk-accent" : "translate-x-[3px] bg-mk-dim",
                  )}
                />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs leading-relaxed text-mk-dim">
        Alerts are delivered in-app only. Email delivery is not enabled, so nothing is sent to your inbox.
      </p>
    </div>
  );
}

export function DeleteAccountForm() {
  const router = useRouter();
  const confirmId = useId();
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (confirm !== "DELETE") return;

    setPending(true);
    setError(null);

    try {
      await sendJson("/api/member/account", "DELETE");
      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the account.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Status message={error} tone="error" />
      <p className="text-sm leading-relaxed text-mk-muted text-pretty">
        Deleting your account removes your watchlists, saved research, notes and notification history. This cannot be
        undone.
      </p>
      <div>
        <label htmlFor={confirmId} className="mb-1.5 block font-marketing-mono text-[11px] uppercase tracking-[0.14em] text-mk-muted">
          Type DELETE to confirm
        </label>
        <input
          id={confirmId}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="off"
          className={inputClass}
          placeholder="DELETE"
        />
      </div>
      <div>
        <button
          type="submit"
          disabled={pending || confirm !== "DELETE"}
          className="rounded-lg border border-mk-warn/40 bg-mk-warn/10 px-3 py-2 text-sm font-medium text-mk-warn transition-colors hover:bg-mk-warn/20 disabled:opacity-40"
        >
          {pending ? "Deleting" : "Delete account"}
        </button>
      </div>
    </form>
  );
}
