import { cn } from "@/lib/utils";

export interface ProvenanceItem {
  label: string;
  value: string;
}

export function ProvenanceStrip({
  items,
  className,
}: {
  items: ProvenanceItem[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 font-marketing-mono text-[10px] tracking-[0.1em] uppercase",
        className,
      )}
    >
      {items.map((item, index) => (
        <div key={item.label} className="flex items-center gap-3">
          {index > 0 ? (
            <span className="text-mk-line-strong" aria-hidden>
              /
            </span>
          ) : null}
          <div className="flex items-center gap-1.5">
            <dt className="text-mk-dim">{item.label}</dt>
            <dd className="text-mk-muted">{item.value}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}
