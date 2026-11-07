"use client";

import Link from "next/link";
import { useId, useState } from "react";
import useSWR from "swr";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

import type { Watchlist } from "@/lib/member/watchlists";
import { fetcher, sendJson } from "@/lib/member/fetcher";
import { SYMBOL_PATTERN } from "@/lib/member/validation";
import { cn } from "@/lib/utils";
import { EmptyState } from "./ui";

type Payload = { watchlists: Watchlist[] };

export function WatchlistManager({
  initial,
  maxWatchlists,
  planLabel,
}: {
  initial: Watchlist[];
  maxWatchlists: number;
  planLabel: string;
}) {
  const { data, mutate, error } = useSWR<Payload>("/api/member/watchlists", fetcher, {
    fallbackData: { watchlists: initial },
  });

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const newNameId = useId();

  const watchlists = data?.watchlists ?? [];

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await mutate();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function createWatchlist(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await run(async () => {
      await sendJson("/api/member/watchlists", "POST", { name });
      setNewName("");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {actionError ? (
        <p role="alert" className="rounded-lg border border-mk-warn/30 bg-mk-warn/10 px-3 py-2 text-sm text-mk-warn">
          {actionError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg border border-mk-warn/30 bg-mk-warn/10 px-3 py-2 text-sm text-mk-warn">
          {error.message}
        </p>
      ) : null}

      {watchlists.length === 0 ? (
        <EmptyState title="No watchlists yet" description="Create a watchlist to start tracking tickers." />
      ) : null}

      {watchlists.map((watchlist) => (
        <WatchlistCard
          key={watchlist.id}
          watchlist={watchlist}
          busy={busy}
          onAddSymbol={(symbol) =>
            run(() => sendJson(`/api/member/watchlists/${watchlist.id}/items`, "POST", { symbol }))
          }
          onRemoveSymbol={(itemId) => run(() => sendJson(`/api/member/watchlist-items/${itemId}`, "DELETE"))}
          onRename={(name) => run(() => sendJson(`/api/member/watchlists/${watchlist.id}`, "PATCH", { name }))}
          onDelete={() => run(() => sendJson(`/api/member/watchlists/${watchlist.id}`, "DELETE"))}
        />
      ))}

      <form onSubmit={createWatchlist} className="flex flex-col gap-2 rounded-xl border border-mk-line bg-mk-surface/60 p-4">
        <label htmlFor={newNameId} className="font-marketing-mono text-[11px] uppercase tracking-[0.16em] text-mk-muted">
          New watchlist
        </label>
        <div className="flex gap-2">
          <input
            id={newNameId}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Semiconductors"
            maxLength={60}
            className="min-w-0 flex-1 rounded-lg border border-mk-line bg-mk-surface px-3 py-2 text-sm text-mk-fg placeholder:text-mk-dim focus:border-mk-accent/60 focus:outline-none focus:ring-2 focus:ring-mk-accent/20"
          />
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-mk-accent px-3 py-2 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="size-4" aria-hidden />
            Create
          </button>
        </div>
        <p className="text-xs text-mk-dim">
          {watchlists.length} of {maxWatchlists} watchlists used on the {planLabel} plan.
        </p>
      </form>
    </div>
  );
}

function WatchlistCard({
  watchlist,
  busy,
  onAddSymbol,
  onRemoveSymbol,
  onRename,
  onDelete,
}: {
  watchlist: Watchlist;
  busy: boolean;
  onAddSymbol: (symbol: string) => Promise<void>;
  onRemoveSymbol: (itemId: string) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const symbolId = useId();
  const renameId = useId();
  const [symbol, setSymbol] = useState("");
  const [symbolError, setSymbolError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(watchlist.name);

  async function addSymbol(event: React.FormEvent) {
    event.preventDefault();
    const next = symbol.trim().toUpperCase();

    if (!SYMBOL_PATTERN.test(next)) {
      setSymbolError("Enter a ticker like NVDA or BRK.B.");
      return;
    }

    setSymbolError(null);
    await onAddSymbol(next);
    setSymbol("");
  }

  async function submitRename(event: React.FormEvent) {
    event.preventDefault();
    const name = draftName.trim();
    if (!name) return;
    await onRename(name);
    setRenaming(false);
  }

  return (
    <section className="overflow-hidden rounded-xl border border-mk-line bg-mk-surface/60">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-mk-line px-4 py-3">
        {renaming ? (
          <form onSubmit={submitRename} className="flex flex-1 items-center gap-2">
            <label htmlFor={renameId} className="sr-only">
              Watchlist name
            </label>
            <input
              id={renameId}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              maxLength={60}
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-mk-line bg-mk-surface px-2 py-1 text-sm text-mk-fg focus:border-mk-accent/60 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy}
              className="inline-flex size-7 items-center justify-center rounded-md text-mk-accent hover:bg-mk-raised disabled:opacity-50"
              aria-label="Save name"
            >
              <Check className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => {
                setRenaming(false);
                setDraftName(watchlist.name);
              }}
              className="inline-flex size-7 items-center justify-center rounded-md text-mk-muted hover:bg-mk-raised"
              aria-label="Cancel rename"
            >
              <X className="size-4" aria-hidden />
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-mk-fg">{watchlist.name}</h2>
            {watchlist.isDefault ? (
              <span className="rounded-full border border-mk-line px-1.5 py-0.5 font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
                Default
              </span>
            ) : null}
            <span className="font-marketing-mono text-[11px] text-mk-dim">{watchlist.items.length}</span>
          </div>
        )}

        {!renaming ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setRenaming(true)}
              className="inline-flex size-7 items-center justify-center rounded-md text-mk-muted transition-colors hover:bg-mk-raised hover:text-mk-fg"
              aria-label={`Rename ${watchlist.name}`}
            >
              <Pencil className="size-3.5" aria-hidden />
            </button>
            {!watchlist.isDefault ? (
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                className="inline-flex size-7 items-center justify-center rounded-md text-mk-muted transition-colors hover:bg-mk-raised hover:text-mk-warn disabled:opacity-50"
                aria-label={`Delete ${watchlist.name}`}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="p-4">
        {watchlist.items.length === 0 ? (
          <p className="text-sm text-mk-muted">No tickers yet. Add one below.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {watchlist.items.map((item) => (
              <li key={item.id}>
                <div className="group inline-flex items-center gap-1 rounded-md border border-mk-line bg-mk-raised pl-2.5 pr-1 py-1">
                  <Link
                    href={`/app/assets/${encodeURIComponent(item.symbol)}`}
                    className="font-marketing-mono text-xs text-mk-fg underline-offset-4 hover:text-mk-accent hover:underline"
                  >
                    {item.symbol}
                  </Link>
                  <button
                    type="button"
                    onClick={() => onRemoveSymbol(item.id)}
                    disabled={busy}
                    className="inline-flex size-5 items-center justify-center rounded text-mk-dim transition-colors hover:text-mk-warn disabled:opacity-50"
                    aria-label={`Remove ${item.symbol} from ${watchlist.name}`}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addSymbol} className="mt-3 flex gap-2">
          <label htmlFor={symbolId} className="sr-only">
            Add a ticker to {watchlist.name}
          </label>
          <input
            id={symbolId}
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            placeholder="Add ticker"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={symbolError ? true : undefined}
            aria-describedby={symbolError ? `${symbolId}-error` : undefined}
            className={cn(
              "w-40 rounded-lg border bg-mk-surface px-3 py-1.5 font-marketing-mono text-sm uppercase text-mk-fg placeholder:normal-case placeholder:text-mk-dim focus:outline-none focus:ring-2 focus:ring-mk-accent/20",
              symbolError ? "border-mk-warn/60" : "border-mk-line focus:border-mk-accent/60",
            )}
          />
          <button
            type="submit"
            disabled={busy || !symbol.trim()}
            className="inline-flex items-center gap-1 rounded-lg border border-mk-line px-2.5 py-1.5 text-sm text-mk-fg transition-colors hover:border-mk-line-strong disabled:opacity-50"
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
      </div>
    </section>
  );
}
