import { cn } from "@/lib/utils";

export function DemoChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-mk-line-strong bg-mk-raised px-2 py-0.5 font-marketing-mono text-[10px] tracking-[0.1em] text-mk-dim uppercase",
        className,
      )}
    >
      <span className="size-1 rounded-full bg-mk-warn" aria-hidden />
      Demonstration data
    </span>
  );
}

export function TerminalFrame({
  title,
  tabs,
  activeTab,
  children,
  footer,
  className,
  glow = false,
}: {
  title: string;
  tabs?: string[];
  activeTab?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-mk-line bg-mk-surface",
        glow &&
          "shadow-[0_1px_0_0_rgba(255,255,255,0.05)_inset,0_60px_140px_-60px_rgba(61,232,168,0.22)]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-mk-line bg-mk-deep/60 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex items-center gap-1.5" aria-hidden>
            <span className="size-1.5 rounded-full bg-mk-line-strong" />
            <span className="size-1.5 rounded-full bg-mk-line-strong" />
            <span className="size-1.5 rounded-full bg-mk-line-strong" />
          </span>
          <span className="truncate font-marketing-mono text-[11px] tracking-[0.1em] text-mk-muted uppercase">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {tabs ? (
            <div className="hidden items-center gap-1 sm:flex" aria-hidden>
              {tabs.map((tab) => (
                <span
                  key={tab}
                  className={cn(
                    "rounded-md px-2 py-1 font-marketing-mono text-[10px] tracking-[0.08em] uppercase",
                    tab === activeTab
                      ? "bg-mk-raised text-mk-fg"
                      : "text-mk-dim",
                  )}
                >
                  {tab}
                </span>
              ))}
            </div>
          ) : null}
          <DemoChip />
        </div>
      </div>
      {children}
      {footer ? (
        <div className="border-t border-mk-line bg-mk-deep/40 px-3 py-2.5 sm:px-4">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
