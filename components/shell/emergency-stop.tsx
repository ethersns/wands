"use client";

import * as React from "react";
import { OctagonX } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { engineMutation } from "@/lib/api/browser";

const CONFIRM_WORD = "STOP";

/**
 * Emergency stop. The control only reports success when the engine has
 * acknowledged the halt — a failed call is surfaced as a failure, never as a
 * green checkmark.
 */
export function EmergencyStop({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const armed = confirmation.trim().toUpperCase() === CONFIRM_WORD;

  async function engage() {
    setPending(true);
    const result = await engineMutation<{ acknowledged: boolean }>(
      "risk/emergency-stop",
      { method: "POST", body: { confirm: CONFIRM_WORD } },
    );
    setPending(false);

    if (!result.ok) {
      toast.error("Emergency stop not acknowledged", {
        description: result.error.message,
        duration: 10_000,
      });
      return;
    }

    setOpen(false);
    setConfirmation("");
    toast.success("Engine acknowledged emergency stop", {
      description: "All bots halted and resting orders cancelled.",
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmation("");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size={compact ? "icon-sm" : "sm"}
          className="border-loss/40 text-loss hover:bg-loss/10 hover:text-loss"
          aria-label="Emergency stop"
        >
          <OctagonX className="size-4" aria-hidden />
          {compact ? null : <span>Emergency stop</span>}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-loss/30 bg-loss/10 text-loss">
            <OctagonX className="size-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <AlertDialogTitle>Halt all trading?</AlertDialogTitle>
            <AlertDialogDescription>
              This asks the engine to stop every bot, cancel resting orders and
              block new trade intents. It is not reversible from the interface —
              trading must be re-armed on the engine.
            </AlertDialogDescription>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="emergency-confirm">
            Type <span className="font-mono text-foreground">{CONFIRM_WORD}</span> to
            confirm
          </Label>
          <Input
            id="emergency-confirm"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={CONFIRM_WORD}
            className="font-mono tracking-[0.2em]"
          />
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!armed || pending}
            onClick={(event) => {
              event.preventDefault();
              void engage();
            }}
          >
            {pending ? "Requesting halt…" : "Halt trading"}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
