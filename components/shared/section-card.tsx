import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  footer,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium tracking-[0.01em] text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={cn("flex-1 px-4 pb-4 sm:px-5 sm:pb-5", bodyClassName)}>
        {children}
      </div>
      {footer ? (
        <div className="border-t border-border px-4 py-2.5 sm:px-5">{footer}</div>
      ) : null}
    </section>
  );
}
