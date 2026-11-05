import { cn } from "@/lib/utils";

export function Sparkline({
  values,
  positive,
  width = 76,
  height = 24,
  className,
}: {
  values: number[];
  positive: boolean;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length < 2) {
    return <div style={{ width, height }} aria-hidden />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);

  const points = values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / span) * (height - 2) - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-hidden
      focusable="false"
    >
      <polyline
        points={points}
        fill="none"
        stroke={positive ? "var(--profit)" : "var(--loss)"}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
