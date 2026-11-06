import Link from "next/link";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground">
        <Compass className="size-4" aria-hidden />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-foreground">Route not found</h1>
        <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
          That section of the terminal does not exist. Return to the command centre
          to continue.
        </p>
      </div>
      <Button asChild size="sm">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
