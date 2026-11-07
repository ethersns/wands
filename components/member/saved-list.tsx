"use client";

import Link from "next/link";
import { useId, useState } from "react";
import useSWR from "swr";
import { Trash2 } from "lucide-react";

import type { SavedItem, SavedKind } from "@/lib/member/saved";
import { fetcher, sendJson } from "@/lib/member/fetcher";
import { cn } from "@/lib/utils";
import { EmptyState } from "./ui";

const FILTERS: Array<{ value: SavedKind | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "signal", label: "Signals" },
  { value: "insider", label: "Filings" },
  { value: "asset", label: "Assets" },
  { value: "filing", label: "Other" },
];

const KIND_LABEL: Record<SavedKind, string> = {
  signal: "Signal",
  insider: "Filing",
  asset: "Asset",
  filing: "Filing",
};

export function SavedList({ initial }: { initial: SavedItem[] }) {
  const { data, mutate, error } = useSWR<{ items: SavedItem[] }>("/api/member/saved", fetcher, {
    fallbackData: { items: initial },
  });
  const [filter, setFilter] = useState<SavedKind | "all">("all");
  const [actionError, setActionError] = useState<string | null>(null);

  const items = data?.items ?? [];
  const visible = filter === "all" ? items : items.filter((item) => item.kind === filter);

  async function remove(id: string) {
    setActionError(null);
    try {
      await sendJson(`/api/member/saved/${id}`, "DELETE");
      await mutate();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not remove that item.");
    }
  }

  async function saveNote(id: string, note: string) {
    setActionError(null);
    try {
      await sendJson(`/api/member/saved/${id}`, "PATCH", { note });
      await mutate();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not save that note.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="rounded-lg border border-mk-warn/30 bg-mk-warn/10 px-3 py-2 text-sm text-mk-warn">
          {error.message}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="rounded-lg border border-mk-warn/30 bg-mk-warn/10 px-3 py-2 text-sm text-mk-warn">
          {actionError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter saved research">
        {FILTERS.map((entry) => {
          const active = filter === entry.value;
          return (
            <button
              key={entry.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(entry.value)}
              className={cn(
                "rounded-md border px-2.5 py-1 font-marketing-mono text-[11px] uppercase tracking-[0.12em] transition-colors",
                active
                  ? "border-mk-accent/40 bg-mk-accent-soft text-mk-accent"
                  : "border-mk-line text-mk-muted hover:text-mk-fg",
              )}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nothing saved here yet"
          description="Save a signal, filing or asset from any research view and it will be collected here with your notes."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((item) => (
            <SavedCard key={item.id} item={item} onRemove={() => remove(item.id)} onSaveNote={(note) => saveNote(item.id, note)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SavedCard({
  item,
  onRemove,
  onSaveNote,
}: {
  item: SavedItem;
  onRemove: () => Promise<void>;
  onSaveNote: (note: string) => Promise<void>;
}) {
  const noteId = useId();
  const [note, setNote] = useState(item.note ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    await onSaveNote(note);
    setPending(false);
    setEditing(false);
  }

  return (
    <li className="rounded-xl border border-mk-line bg-mk-surface/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-mk-line px-1.5 py-0.5 font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
              {KIND_LABEL[item.kind]}
            </span>
            {item.symbol ? (
              <Link
                href={`/app/assets/${encodeURIComponent(item.symbol)}`}
                className="font-marketing-mono text-xs text-mk-accent underline-offset-4 hover:underline"
              >
                {item.symbol}
              </Link>
            ) : null}
            <span className="font-marketing-mono text-[10px] text-mk-dim">
              {new Date(item.createdAt).toISOString().slice(0, 10)}
            </span>
          </div>
          <p className="mt-1.5 text-sm font-medium text-mk-fg text-pretty">{item.title}</p>
          {item.summary ? (
            <p className="mt-1 text-sm leading-relaxed text-mk-muted text-pretty">{item.summary}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-mk-muted transition-colors hover:bg-mk-raised hover:text-mk-warn"
          aria-label={`Remove ${item.title}`}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>

      {editing ? (
        <form onSubmit={submit} className="mt-3">
          <label htmlFor={noteId} className="sr-only">
            Note for {item.title}
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={2000}
            autoFocus
            className="w-full rounded-lg border border-mk-line bg-mk-surface px-3 py-2 text-sm text-mk-fg placeholder:text-mk-dim focus:border-mk-accent/60 focus:outline-none focus:ring-2 focus:ring-mk-accent/20"
            placeholder="Why does this matter to you?"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-mk-accent px-2.5 py-1.5 text-xs font-semibold text-mk-accent-ink disabled:opacity-60"
            >
              {pending ? "Saving" : "Save note"}
            </button>
            <button
              type="button"
              onClick={() => {
                setNote(item.note ?? "");
                setEditing(false);
              }}
              className="rounded-md border border-mk-line px-2.5 py-1.5 text-xs text-mk-muted hover:text-mk-fg"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3">
          {item.note ? (
            <p className="rounded-lg border border-mk-line bg-mk-deep/40 px-3 py-2 text-sm leading-relaxed text-mk-fg text-pretty">
              {item.note}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-2 text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
          >
            {item.note ? "Edit note" : "Add a note"}
          </button>
        </div>
      )}
    </li>
  );
}
