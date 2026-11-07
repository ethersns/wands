"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { sendJson } from "@/lib/member/fetcher";

/**
 * The member's private note on one saved record.
 *
 * The note lives in the member's own library, never in the research engine, so
 * it is written through the member API and re-read from the server after a save
 * rather than being trusted from local state.
 */
export function SavedNoteEditor({ id, initialNote }: { id: string; initialNote: string | null }) {
  const router = useRouter();
  const noteId = useId();
  const [note, setNote] = useState(initialNote ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await sendJson(`/api/member/saved/${id}`, "PATCH", { note });
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that note.");
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div>
        {note ? (
          <p className="rounded-lg border border-mk-line bg-mk-deep/40 px-3 py-2 text-sm leading-relaxed text-mk-fg text-pretty">
            {note}
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-mk-muted text-pretty">
            No note yet. A note is private to you and is never sent to the research engine.
          </p>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-2 text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
        >
          {note ? "Edit note" : "Add a note"}
        </button>
        {error ? (
          <p role="alert" className="mt-2 text-[11px] text-mk-warn">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor={noteId} className="sr-only">
        Your note
      </label>
      <textarea
        id={noteId}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={4}
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
            setNote(initialNote ?? "");
            setError(null);
            setEditing(false);
          }}
          className="rounded-md border border-mk-line px-2.5 py-1.5 text-xs text-mk-muted hover:text-mk-fg"
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[11px] text-mk-warn">
          {error}
        </p>
      ) : null}
    </form>
  );
}
