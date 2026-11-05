import { cn } from "@/lib/utils";
import { toneChip, toneDot, type StatusTone } from "@/lib/status";

export function StatusChip({
  label,
  tone,
  className,
  pulse = false,
}: {
  label: string;
  tone: StatusTone;
  className?: string;
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-[0.04em] whitespace-nowrap uppercase",
        toneChip[tone],
        className,
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", toneDot[tone], pulse && "animate-pulse-dot")}
        aria-hidden
      />
      {label}
    </span>
  );
}
