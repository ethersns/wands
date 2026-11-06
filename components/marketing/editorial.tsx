import { cn } from "@/lib/utils";

export function SectionLabel({
  children,
  className,
  index,
}: {
  children: React.ReactNode;
  className?: string;
  index?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-2.5 font-marketing-mono text-[10px] tracking-[0.2em] text-mk-dim uppercase",
        className,
      )}
    >
      <span className="h-2.5 w-px bg-mk-accent" aria-hidden />
      {index ? <span className="text-mk-accent">{index}</span> : null}
      <span>{children}</span>
    </p>
  );
}

export function EditorialHeadline({
  lines,
  className,
  as: Tag = "h2",
}: {
  lines: React.ReactNode[];
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <Tag
      className={cn(
        "font-editorial font-semibold tracking-[-0.045em] text-balance text-mk-fg",
        className,
      )}
    >
      {lines.map((line, index) => (
        <span
          key={index}
          className="mk-line"
          style={{ ["--i" as string]: index }}
        >
          <span>{line}</span>
        </span>
      ))}
    </Tag>
  );
}

export function Rule({
  className,
  accent = false,
}: {
  className?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn("relative h-px w-full bg-mk-line", className)}
      aria-hidden
    >
      {accent ? (
        <span className="absolute inset-y-0 left-0 w-16 bg-mk-accent" />
      ) : null}
    </div>
  );
}

export function MarginNote({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="font-marketing-mono text-[9px] tracking-[0.18em] text-mk-dim uppercase">
        {label}
      </span>
      <span className="text-[12.5px] leading-relaxed text-mk-muted">
        {children}
      </span>
    </div>
  );
}
