"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Search } from "lucide-react";

import { SYMBOL_PATTERN } from "@/lib/member/validation";

export function SymbolSearch({ placeholder = "Search a ticker, e.g. NVDA" }: { placeholder?: string }) {
  const router = useRouter();
  const inputId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const symbol = value.trim().toUpperCase();

    if (!SYMBOL_PATTERN.test(symbol)) {
      setError("Enter a ticker like NVDA or BRK.B.");
      return;
    }

    setError(null);
    router.push(`/app/assets/${encodeURIComponent(symbol)}`);
  }

  return (
    <form onSubmit={onSubmit} className="w-full">
      <label htmlFor={inputId} className="sr-only">
        Search a ticker symbol
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mk-dim" aria-hidden />
        <input
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className="w-full rounded-lg border border-mk-line bg-mk-surface py-2.5 pl-9 pr-3 text-sm text-mk-fg placeholder:text-mk-dim focus:border-mk-accent/60 focus:outline-none focus:ring-2 focus:ring-mk-accent/20"
        />
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="mt-1.5 text-xs text-mk-warn">
          {error}
        </p>
      ) : null}
    </form>
  );
}
