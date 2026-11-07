"use client";

import { useState } from "react";
import { Check, ListPlus } from "lucide-react";

import { fetcher, sendJson } from "@/lib/member/fetcher";

type WatchlistSummary = { id: string; isDefault: boolean };

export function AddToWatchlist({ symbol }: { symbol: string }) {
  const [state, setState] = useState<"idle" | "pending" | "added">("idle");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setState("pending");
    setError(null);

    try {
      const { watchlists } = await fetcher<{ watchlists: WatchlistSummary[] }>("/api/member/watchlists");
      const target = watchlists.find((watchlist) => watchlist.isDefault) ?? watchlists[0];

      if (!target) throw new Error("Create a watchlist first.");

      await sendJson(`/api/member/watchlists/${target.id}/items`, "POST", { symbol });
      setState("added");
    } catch (caught) {
      setState("idle");
      setError(caught instanceof Error ? caught.message : "Could not add that symbol.");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={add}
        disabled={state !== "idle"}
        className="inline-flex items-center gap-1.5 rounded-lg border border-mk-line px-3 py-2 text-sm text-mk-fg transition-colors hover:border-mk-line-strong disabled:opacity-60"
      >
        {state === "added" ? <Check className="size-4 text-mk-accent" aria-hidden /> : <ListPlus className="size-4" aria-hidden />}
        {state === "added" ? "On watchlist" : state === "pending" ? "Adding" : "Add to watchlist"}
      </button>
      {error ? (
        <p role="alert" className="text-[11px] text-mk-warn">
          {error}
        </p>
      ) : null}
    </div>
  );
}
