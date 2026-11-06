import { cn } from "@/lib/utils";

export function Eyebrow({
  children,
  className,
  dot = true,
}: {
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 font-marketing-mono text-[11px] font-medium tracking-[0.18em] text-mk-muted uppercase",
        className,
      )}
    >
      {dot ? (
        <span className="size-1.5 rounded-full bg-mk-accent" aria-hidden />
      ) : null}
      {children}
    </p>
  );
}
