import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center",
        className,
      )}
    >
      <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="max-w-sm">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-pretty text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
