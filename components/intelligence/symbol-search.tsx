"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Ticker lookup for the asset research view. The symbol is a path segment, so a
 * plain GET form cannot express it; this navigates instead.
 */
export function SymbolSearch({
  defaultValue = "",
  className,
}: {
  defaultValue?: string;
  className?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const symbol = value.trim().toUpperCase();
        if (!symbol) return;
        router.push(`/intelligence/symbols/${encodeURIComponent(symbol)}`);
      }}
      className={cn("flex items-center gap-1.5", className)}
    >
      <label htmlFor="asset-symbol" className="sr-only">
        Research an asset by ticker
      </label>
      <input
        id="asset-symbol"
        name="symbol"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Ticker"
        autoComplete="off"
        spellCheck={false}
        maxLength={12}
        className="h-7 w-24 rounded-md border border-border bg-surface px-2 font-mono text-[11px] tracking-[0.04em] text-foreground uppercase placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      <button
        type="submit"
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Search className="size-3" aria-hidden />
        Research
      </button>
    </form>
  );
}
