"use client";

import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg border border-loss/30 bg-loss/10 text-loss">
        <CircleAlert className="size-4" aria-hidden />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-foreground">
          This view could not be rendered
        </h1>
        <p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted-foreground">
          {error.message || "An unexpected error occurred while loading engine data."}
        </p>
        {error.digest ? (
          <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
            digest {error.digest}
          </p>
        ) : null}
      </div>
      <Button size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
