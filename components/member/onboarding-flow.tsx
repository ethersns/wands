"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ArrowRight, Check, Plus, X } from "lucide-react";

import { sendJson } from "@/lib/member/fetcher";
import { SYMBOL_PATTERN } from "@/lib/member/validation";
import { cn } from "@/lib/utils";

const INTERESTS = [
  "Semiconductors",
  "Software",
  "Energy",
  "Healthcare",
  "Financials",
  "Industrials",
  "Consumer",
  "Real estate",
  "Materials",
  "Utilities",
];

const STEPS = ["You", "Interests", "Watchlist"] as const;

export function OnboardingFlow({ initialName }: { initialName: string }) {
  const router = useRouter();
  const nameId = useId();
  const symbolId = useId();

  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName);
  const [interests, setInterests] = useState<string[]>([]);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [symbolError, setSymbolError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleInterest(interest: string) {
    setInterests((current) =>
      current.includes(interest) ? current.filter((entry) => entry !== interest) : [...current, interest],
    );
  }

  function addSymbol(event: React.FormEvent) {
    event.preventDefault();
    const symbol = draft.trim().toUpperCase();

    if (!SYMBOL_PATTERN.test(symbol)) {
      setSymbolError("Enter a ticker like NVDA or BRK.B.");
      return;
    }
    if (symbols.includes(symbol)) {
      setSymbolError("That ticker is already on the list.");
      return;
    }

    setSymbolError(null);
    setSymbols((current) => [...current, symbol]);
    setDraft("");
  }

  async function finish(completed: boolean) {
    setPending(true);
    setError(null);

    try {
      await sendJson("/api/member/onboarding", "PATCH", {
        step: "done",
        completed,
        displayName: name.trim() || undefined,
        interests,
        seedSymbols: symbols,
      });
      router.push("/app");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your setup.");
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-lg">
      <ol className="mb-8 flex items-center gap-2" aria-label="Onboarding progress">
        {STEPS.map((label, index) => {
          const done = index < step;
          const active = index === step;
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-full border font-marketing-mono text-[10px]",
                  done
                    ? "border-mk-accent/50 bg-mk-accent text-mk-accent-ink"
                    : active
                      ? "border-mk-accent/50 text-mk-accent"
                      : "border-mk-line text-mk-dim",
                )}
                aria-current={active ? "step" : undefined}
              >
                {done ? <Check className="size-3" aria-hidden /> : index + 1}
              </span>
              <span className={cn("font-marketing-mono text-[10px] uppercase tracking-[0.14em]", active ? "text-mk-fg" : "text-mk-dim")}>
                {label}
              </span>
              {index < STEPS.length - 1 ? <span className="h-px flex-1 bg-mk-line" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>

      <div className="rounded-2xl border border-mk-line bg-mk-surface/70 p-6 sm:p-8">
        {error ? (
          <p role="alert" className="mb-4 rounded-lg border border-mk-warn/30 bg-mk-warn/10 px-3 py-2 text-sm text-mk-warn">
            {error}
          </p>
        ) : null}

        {step === 0 ? (
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-mk-fg text-balance">
              What should we call you?
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-mk-muted text-pretty">
              This is how your workspace greets you. You can change it later.
            </p>
            <div className="mt-5">
              <label htmlFor={nameId} className="mb-1.5 block font-marketing-mono text-[11px] uppercase tracking-[0.14em] text-mk-muted">
                Display name
              </label>
              <input
                id={nameId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                className="w-full rounded-lg border border-mk-line bg-mk-surface px-3 py-2.5 text-sm text-mk-fg focus:border-mk-accent/60 focus:outline-none focus:ring-2 focus:ring-mk-accent/20"
              />
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-mk-fg text-balance">
              What do you follow?
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-mk-muted text-pretty">
              Pick a few sectors. This shapes what we surface first.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {INTERESTS.map((interest) => {
                const active = interests.includes(interest);
                return (
                  <button
                    key={interest}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleInterest(interest)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "border-mk-accent/50 bg-mk-accent-soft text-mk-accent"
                        : "border-mk-line text-mk-muted hover:border-mk-line-strong hover:text-mk-fg",
                    )}
                  >
                    {interest}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-mk-fg text-balance">
              Start a watchlist
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-mk-muted text-pretty">
              Add a few tickers you already follow. You can add more any time.
            </p>

            <form onSubmit={addSymbol} className="mt-5 flex gap-2">
              <label htmlFor={symbolId} className="sr-only">
                Ticker symbol
              </label>
              <input
                id={symbolId}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="NVDA"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={symbolError ? true : undefined}
                aria-describedby={symbolError ? `${symbolId}-error` : undefined}
                className="w-32 rounded-lg border border-mk-line bg-mk-surface px-3 py-2 font-marketing-mono text-sm uppercase text-mk-fg placeholder:text-mk-dim focus:border-mk-accent/60 focus:outline-none focus:ring-2 focus:ring-mk-accent/20"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-lg border border-mk-line px-3 py-2 text-sm text-mk-fg transition-colors hover:border-mk-line-strong"
              >
                <Plus className="size-3.5" aria-hidden />
                Add
              </button>
            </form>
            {symbolError ? (
              <p id={`${symbolId}-error`} role="alert" className="mt-1.5 text-xs text-mk-warn">
                {symbolError}
              </p>
            ) : null}

            {symbols.length > 0 ? (
              <ul className="mt-4 flex flex-wrap gap-2">
                {symbols.map((symbol) => (
                  <li key={symbol}>
                    <span className="inline-flex items-center gap-1 rounded-md border border-mk-line bg-mk-raised py-1 pl-2.5 pr-1 font-marketing-mono text-xs text-mk-fg">
                      {symbol}
                      <button
                        type="button"
                        onClick={() => setSymbols((current) => current.filter((entry) => entry !== symbol))}
                        className="inline-flex size-5 items-center justify-center rounded text-mk-dim hover:text-mk-warn"
                        aria-label={`Remove ${symbol}`}
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="mt-7 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => finish(false)}
            disabled={pending}
            className="text-sm text-mk-dim underline-offset-4 hover:text-mk-muted hover:underline disabled:opacity-50"
          >
            Skip for now
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((current) => current + 1)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-mk-accent px-4 py-2.5 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90"
            >
              Continue
              <ArrowRight className="size-4" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => finish(true)}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-mk-accent px-4 py-2.5 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Setting up" : "Enter workspace"}
              <ArrowRight className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
