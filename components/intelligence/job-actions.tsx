"use client";

import * as React from "react";
import { Loader2, Pause, Play, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { IntelBackfillRequest, IntelJob } from "@/lib/api/contracts";
import type { ActionOutcome } from "@/lib/intelligence/action-outcome";
import {
  setJobPausedAction,
  startBackfillAction,
} from "@/app/intelligence/operations/actions";

export function JobPauseControl({
  job,
  onOutcome,
}: {
  job: IntelJob;
  onOutcome: (outcome: ActionOutcome) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const nextPaused = !job.paused;
  const verb = nextPaused ? "Pause" : "Resume";

  function confirm() {
    startTransition(async () => {
      const outcome = await setJobPausedAction(job.name, nextPaused);
      onOutcome(outcome);
      setOpen(false);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 px-2 text-[11px]"
      >
        {nextPaused ? (
          <Pause className="size-3" aria-hidden />
        ) : (
          <Play className="size-3" aria-hidden />
        )}
        {verb}
        <span className="sr-only"> collection job {job.name}</span>
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>
            {verb} {job.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {nextPaused
              ? "The scheduler will stop starting this collector. Stored research is unaffected, but no new filings will be ingested until it is resumed."
              : "The scheduler will start this collector again on its next tick. Collection resumes from the stored checkpoint."}
          </AlertDialogDescription>
          <div className="mt-4 flex items-center justify-end gap-2">
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              size="sm"
              variant={nextPaused ? "destructive" : "default"}
              onClick={confirm}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : null}
              {pending ? "Sending" : `Confirm ${verb.toLowerCase()}`}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const FORM_FAMILIES: { value: NonNullable<IntelBackfillRequest["formFamily"]>; label: string }[] = [
  { value: "ownership", label: "Ownership (Forms 3/4/5)" },
  { value: "institutional", label: "Institutional (13F)" },
];

/**
 * A bounded backfill.
 *
 * The filing cap is required and cannot be cleared: an unbounded SEC crawl is
 * not something a page should be able to start, and the engine bounds the run
 * for the same reason.
 */
export function BackfillForm({
  onOutcome,
}: {
  onOutcome: (outcome: ActionOutcome) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [formFamily, setFormFamily] =
    React.useState<NonNullable<IntelBackfillRequest["formFamily"]>>("ownership");
  const [ciks, setCiks] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [maxFilings, setMaxFilings] = React.useState("50");

  const cap = Number(maxFilings);
  const capValid = Number.isInteger(cap) && cap > 0 && cap <= 500;

  function confirm() {
    if (!capValid) return;
    const request: IntelBackfillRequest = {
      formFamily,
      maxFilings: cap,
      ...(ciks.trim()
        ? {
            ciks: ciks
              .split(/[\s,]+/)
              .map((cik) => cik.trim())
              .filter(Boolean),
          }
        : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    };

    startTransition(async () => {
      const outcome = await startBackfillAction(request);
      onOutcome(outcome);
      setOpen(false);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 px-2 text-[11px]"
      >
        <ShieldAlert className="size-3" aria-hidden />
        Bounded backfill
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Start a bounded backfill</AlertDialogTitle>
          <AlertDialogDescription>
            This asks the engine to fetch historical filings from the SEC. The run
            is capped by the filing limit below and is recorded in the audit log
            against the engine principal.
          </AlertDialogDescription>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                Form family
              </span>
              <select
                value={formFamily}
                onChange={(event) =>
                  setFormFamily(
                    event.target.value as NonNullable<IntelBackfillRequest["formFamily"]>,
                  )
                }
                className="h-8 rounded-md border border-input bg-surface px-2 text-[12px] text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {FORM_FAMILIES.map((family) => (
                  <option key={family.value} value={family.value}>
                    {family.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                Max filings
              </span>
              <input
                type="number"
                min={1}
                max={500}
                value={maxFilings}
                onChange={(event) => setMaxFilings(event.target.value)}
                aria-invalid={!capValid}
                className="h-8 rounded-md border border-input bg-surface px-2 font-mono text-[12px] text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              />
              {!capValid ? (
                <span className="text-[10px] text-loss">
                  Enter a whole number between 1 and 500.
                </span>
              ) : null}
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                Start date
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="h-8 rounded-md border border-input bg-surface px-2 font-mono text-[12px] text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                End date
              </span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="h-8 rounded-md border border-input bg-surface px-2 font-mono text-[12px] text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                Issuer CIKs (optional)
              </span>
              <input
                value={ciks}
                onChange={(event) => setCiks(event.target.value)}
                placeholder="Leave empty to use the configured issuers"
                className="h-8 rounded-md border border-input bg-surface px-2 font-mono text-[12px] text-foreground placeholder:font-sans placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              />
            </label>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              size="sm"
              onClick={confirm}
              disabled={pending || !capValid}
            >
              {pending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
              {pending ? "Running" : "Start backfill"}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
