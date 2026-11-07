"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";

import { cn } from "@/lib/utils";

type SaveKind = "signal" | "filing" | "asset" | "insider";

export function SaveButton({
  kind,
  refId,
  symbol,
  title,
  summary,
  payload,
  initialSaved = false,
  className,
}: {
  kind: SaveKind;
  refId: string;
  symbol?: string;
  title: string;
  summary?: string;
  payload?: Record<string, unknown>;
  initialSaved?: boolean;
  className?: string;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);

    try {
      if (saved) {
        const response = await fetch(`/api/member/saved?kind=${kind}&refId=${encodeURIComponent(refId)}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error("Could not remove that item.");
        setSaved(false);
      } else {
        const response = await fetch("/api/member/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, refId, symbol, title, summary, payload }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Could not save that item.");
        }
        setSaved(true);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={saved}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-marketing-mono text-[10px] uppercase tracking-[0.12em] transition-colors disabled:opacity-60",
          saved
            ? "border-mk-accent/40 bg-mk-accent-soft text-mk-accent"
            : "border-mk-line text-mk-muted hover:border-mk-line-strong hover:text-mk-fg",
        )}
      >
        {saved ? <BookmarkCheck className="size-3" aria-hidden /> : <Bookmark className="size-3" aria-hidden />}
        {saved ? "Saved" : "Save"}
      </button>
      {error ? (
        <p role="alert" className="text-[11px] text-mk-warn">
          {error}
        </p>
      ) : null}
    </div>
  );
}
