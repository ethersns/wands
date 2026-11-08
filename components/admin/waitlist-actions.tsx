"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteWaitlistEntryAction } from "@/lib/admin/actions";
import { cn } from "@/lib/utils";

/**
 * Removes one waitlist signup.
 *
 * The dialog says explicitly that a registered account with the same address is
 * untouched, because that is the mistake this control could invite: a waitlist
 * contact and a member account are separate records that share an address.
 */
export function WaitlistRowActions({
  id,
  email,
  memberId,
}: {
  id: string;
  email: string;
  memberId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(deleteWaitlistEntryAction, null);

  return (
    <>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Remove ${email} from the waitlist`}
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 aria-hidden />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form action={formAction} className="flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle>Remove {email} from the waitlist</DialogTitle>
              <DialogDescription>
                The signup record is deleted. This does not affect any account.
              </DialogDescription>
            </DialogHeader>

            <input type="hidden" name="id" value={id} />

            {memberId ? (
              <p className="rounded-md border border-border bg-muted px-2.5 py-2 text-[11px] leading-relaxed text-foreground">
                This address also belongs to a registered member. That account is a separate
                record and will not be touched.
              </p>
            ) : null}

            {state ? (
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
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {state?.ok ? "Close" : "Cancel"}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={pending || state?.ok}
              >
                {pending ? "Removing…" : state?.ok ? "Removed" : "Remove entry"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
