"use client";

import { useActionState, useState } from "react";
import { Ban, RotateCcw, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionState } from "@/lib/admin/action-state";
import {
  deleteMemberAction,
  reactivateMemberAction,
  suspendMemberAction,
} from "@/lib/admin/actions";
import { cn } from "@/lib/utils";

/**
 * Operator controls for one account.
 *
 * Each control opens a dialog that states the consequence before it happens,
 * and each dialog shows the server's own answer afterwards rather than a
 * generic "done". A refusal — a live Stripe subscription, an operator account,
 * a mismatched confirmation — is information the owner needs, not an error to
 * hide.
 */

type Mode = "suspend" | "reactivate" | "delete";

const fieldClass =
  "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none";

function ResultNotice({ state }: { state: ActionState | null }) {
  if (!state) return null;

  return (
    <p
      role="status"
      className={cn(
        "rounded-md border px-2.5 py-2 text-[11px] leading-relaxed",
        state.ok
          ? "border-profit/30 bg-profit/10 text-profit"
          : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      {state.message}
    </p>
  );
}

function Consequence({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
      <div className="text-[11px] leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

function SuspendForm({
  userId,
  email,
  onClose,
}: {
  userId: string;
  email: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(suspendMemberAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <DialogHeader>
        <DialogTitle>Suspend {email}</DialogTitle>
        <DialogDescription>
          The account keeps its data, but it cannot sign in and every active session is
          revoked immediately.
        </DialogDescription>
      </DialogHeader>

      <Consequence>
        Sign-in is refused at the authentication layer, not just in the interface. Existing
        sessions are deleted, so a member who is signed in right now is signed out on their
        next request.
      </Consequence>

      <input type="hidden" name="userId" value={userId} />

      <div className="flex flex-col gap-1">
        <label
          htmlFor={`suspend-reason-${userId}`}
          className="text-[10px] font-medium tracking-[0.05em] text-muted-foreground uppercase"
        >
          Reason (recorded in the audit log)
        </label>
        <textarea
          id={`suspend-reason-${userId}`}
          name="reason"
          required
          maxLength={500}
          rows={2}
          placeholder="Chargeback investigation, terms breach, member request…"
          className={fieldClass}
        />
      </div>

      <ResultNotice state={state} />

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {state?.ok ? "Close" : "Cancel"}
        </Button>
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          disabled={pending || state?.ok}
        >
          {pending ? "Suspending…" : state?.ok ? "Suspended" : "Suspend account"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ReactivateForm({
  userId,
  email,
  returnTo,
  onClose,
}: {
  userId: string;
  email: string;
  returnTo: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(reactivateMemberAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <DialogHeader>
        <DialogTitle>Reactivate {email}</DialogTitle>
        <DialogDescription>
          The member can sign in again. Their data was never removed, so nothing is restored.
        </DialogDescription>
      </DialogHeader>

      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="returnTo" value={returnTo} />

      <div className="flex flex-col gap-1">
        <label
          htmlFor={`reactivate-reason-${userId}`}
          className="text-[10px] font-medium tracking-[0.05em] text-muted-foreground uppercase"
        >
          Reason (optional)
        </label>
        <textarea
          id={`reactivate-reason-${userId}`}
          name="reason"
          maxLength={500}
          rows={2}
          placeholder="Appeal upheld, payment resolved…"
          className={fieldClass}
        />
      </div>

      <ResultNotice state={state} />

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {state?.ok ? "Close" : "Cancel"}
        </Button>
        <Button type="submit" variant="profit" size="sm" disabled={pending || state?.ok}>
          {pending ? "Reactivating…" : state?.ok ? "Reactivated" : "Reactivate account"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DeleteForm({
  userId,
  email,
  onClose,
}: {
  userId: string;
  email: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(deleteMemberAction, null);
  const [typed, setTyped] = useState("");

  const confirmed = typed.trim().toLowerCase() === email.trim().toLowerCase();

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <DialogHeader>
        <DialogTitle>Delete {email}</DialogTitle>
        <DialogDescription>
          This removes the account and everything attached to it. It cannot be undone.
        </DialogDescription>
      </DialogHeader>

      <Consequence>
        <span className="font-medium">Deleted:</span> the account, profile, watchlists, saved
        research, notifications, preferences, membership and sessions.
        <br />
        <span className="font-medium">Retained:</span> Stripe billing records, and the
        sign-in and security history with the link to this person removed.
      </Consequence>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A live Stripe subscription blocks deletion. Cancel it in Stripe first — this screen
        will tell you if that is the case.
      </p>

      <input type="hidden" name="userId" value={userId} />

      <div className="flex flex-col gap-1">
        <label
          htmlFor={`delete-confirm-${userId}`}
          className="text-[10px] font-medium tracking-[0.05em] text-muted-foreground uppercase"
        >
          Type {email} to confirm
        </label>
        <input
          id={`delete-confirm-${userId}`}
          name="confirmEmail"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className={cn(fieldClass, "font-mono")}
        />
      </div>

      <ResultNotice state={state} />

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {state?.ok ? "Close" : "Cancel"}
        </Button>
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          disabled={pending || !confirmed || state?.ok}
        >
          {pending ? "Deleting…" : state?.ok ? "Deleted" : "Delete account permanently"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function MemberActions({
  userId,
  email,
  status,
  returnTo = "/dashboard/members",
}: {
  userId: string;
  email: string;
  status: string;
  /** Where a successful reactivation reports back to. */
  returnTo?: string;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const suspended = status === "suspended";

  return (
    <div className="flex items-center gap-1.5">
      {suspended ? (
        <Button size="sm" variant="outline" onClick={() => setMode("reactivate")}>
          <RotateCcw aria-hidden />
          Reactivate
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setMode("suspend")}>
          <Ban aria-hidden />
          Suspend
        </Button>
      )}

      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setMode("delete")}
      >
        <Trash2 aria-hidden />
        Delete
      </Button>

      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open) setMode(null);
        }}
      >
        <DialogContent>
          {mode === "suspend" ? (
            <SuspendForm userId={userId} email={email} onClose={() => setMode(null)} />
          ) : null}
          {mode === "reactivate" ? (
            <ReactivateForm
              userId={userId}
              email={email}
              returnTo={returnTo}
              onClose={() => setMode(null)}
            />
          ) : null}
          {mode === "delete" ? (
            <DeleteForm userId={userId} email={email} onClose={() => setMode(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
