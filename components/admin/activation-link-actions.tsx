"use client";

import { useActionState, useRef, useState } from "react";
import { Check, Copy, Link2, Mail, ShieldOff } from "lucide-react";

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
  emailActivationLinkAction,
  issueActivationLinkAction,
  revokeActivationLinkAction,
} from "@/lib/admin/actions";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Operator controls for a paid signup that has not become an account.
 *
 * The activation token is stored only as a hash, so there is no "resend the
 * link they already have" — the link cannot be recovered, by this screen or by
 * anyone with database access. Every control here therefore mints a new link
 * and says so, because the customer's previous link stops working the moment
 * one is issued.
 */

type Mode = "issue" | "email" | "revoke";

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

function CopyField({ url, expiresAt }: { url: string; expiresAt?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 2000);
    } catch {
      inputRef.current?.select();
      setStatus("manual");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="activation-link"
        className="text-[10px] font-medium tracking-[0.05em] text-muted-foreground uppercase"
      >
        Activation link
      </label>
      <div className="flex gap-1.5">
        <input
          id="activation-link"
          ref={inputRef}
          readOnly
          value={url}
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          className={cn(fieldClass, "min-w-0 flex-1 font-mono text-[10px]")}
        />
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          {status === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
          {status === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {status === "manual"
          ? "The clipboard is not available here. The link is selected — copy it with your keyboard."
          : expiresAt
            ? `Shown once. It stops working on ${formatDateTime(expiresAt)} UTC.`
            : "Shown once. It is stored only as a hash and cannot be read back."}
      </p>
    </div>
  );
}

function IssueForm({
  intentId,
  email,
  onClose,
}: {
  intentId: string;
  email: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(issueActivationLinkAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <DialogHeader>
        <DialogTitle>Activation link for {email}</DialogTitle>
        <DialogDescription>
          The link is stored only as a hash, so an existing one cannot be read back. Issuing a new
          link replaces it and stops the old one working.
        </DialogDescription>
      </DialogHeader>

      <input type="hidden" name="intentId" value={intentId} />

      <ResultNotice state={state} />
      {state?.ok && state.url ? (
        <CopyField url={state.url} expiresAt={state.expiresAt} />
      ) : null}

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {state?.ok ? "Close" : "Cancel"}
        </Button>
        <Button type="submit" size="sm" disabled={pending || state?.ok}>
          {pending ? "Issuing…" : state?.ok ? "Issued" : "Issue link"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function EmailForm({
  intentId,
  email,
  onClose,
}: {
  intentId: string;
  email: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(emailActivationLinkAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <DialogHeader>
        <DialogTitle>Email a new link to {email}</DialogTitle>
        <DialogDescription>
          A fresh link is created and sent. The link the customer already holds stops working.
        </DialogDescription>
      </DialogHeader>

      <input type="hidden" name="intentId" value={intentId} />

      <ResultNotice state={state} />
      {state && !state.ok && state.url ? (
        <CopyField url={state.url} expiresAt={state.expiresAt} />
      ) : null}

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {state?.ok ? "Close" : "Cancel"}
        </Button>
        <Button type="submit" size="sm" disabled={pending || state?.ok}>
          {pending ? "Sending…" : state?.ok ? "Sent" : "Send link"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RevokeForm({
  intentId,
  email,
  onClose,
}: {
  intentId: string;
  email: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(revokeActivationLinkAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <DialogHeader>
        <DialogTitle>Revoke the link for {email}</DialogTitle>
        <DialogDescription>
          The link the customer holds stops working immediately. They will need a new one to
          activate.
        </DialogDescription>
      </DialogHeader>

      <input type="hidden" name="intentId" value={intentId} />

      <ResultNotice state={state} />

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {state?.ok ? "Close" : "Cancel"}
        </Button>
        <Button type="submit" variant="destructive" size="sm" disabled={pending || state?.ok}>
          {pending ? "Revoking…" : state?.ok ? "Revoked" : "Revoke link"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ActivationLinkActions({
  intentId,
  email,
  hasLiveLink,
  emailConfigured,
}: {
  intentId: string;
  email: string;
  hasLiveLink: boolean;
  emailConfigured: boolean;
}) {
  const [mode, setMode] = useState<Mode | null>(null);

  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant="outline" onClick={() => setMode("issue")}>
        <Link2 aria-hidden />
        Get link
      </Button>

      {emailConfigured ? (
        <Button size="sm" variant="ghost" onClick={() => setMode("email")}>
          <Mail aria-hidden />
          Email
        </Button>
      ) : null}

      {hasLiveLink ? (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setMode("revoke")}
        >
          <ShieldOff aria-hidden />
          Revoke
        </Button>
      ) : null}

      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open) setMode(null);
        }}
      >
        <DialogContent>
          {mode === "issue" ? (
            <IssueForm intentId={intentId} email={email} onClose={() => setMode(null)} />
          ) : null}
          {mode === "email" ? (
            <EmailForm intentId={intentId} email={email} onClose={() => setMode(null)} />
          ) : null}
          {mode === "revoke" ? (
            <RevokeForm intentId={intentId} email={email} onClose={() => setMode(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
