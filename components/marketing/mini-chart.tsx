import { cn } from "@/lib/utils";

function toPoints(series: number[], width: number, height: number, pad: number) {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const step = series.length > 1 ? (width - pad * 2) / (series.length - 1) : 0;

  return series.map((value, index) => {
    const x = pad + index * step;
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });
}

function toPath(points: readonly (readonly [number, number])[]) {
  return points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
}

export function MiniChart({
  series,
  splitIndex,
  className,
  height = 132,
  label,
}: {
  series: number[];
  splitIndex?: number;
  className?: string;
  height?: number;
  label?: string;
}) {
  const width = 480;
  const pad = 6;
  const points = toPoints(series, width, height, pad);
  const split = splitIndex ?? series.length;
  const inSample = points.slice(0, Math.max(split, 2));
  const outSample = points.slice(Math.max(split - 1, 0));
  const areaPath = `${toPath(points)} L${points[points.length - 1][0].toFixed(2)},${height} L${points[0][0].toFixed(2)},${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label ?? "Illustrative performance curve"}
      className={cn("h-full w-full", className)}
    >
      <path d={areaPath} fill="rgba(61,232,168,0.07)" />
      <path
        d={toPath(inSample)}
        fill="none"
        stroke="rgba(236,238,242,0.45)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      <path
        d={toPath(outSample)}
        fill="none"
        stroke="var(--mk-accent)"
        strokeWidth="1.75"
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      {splitIndex !== undefined && points[splitIndex] ? (
        <line
          x1={points[splitIndex][0]}
          y1={0}
          x2={points[splitIndex][0]}
          y2={height}
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="1"
          strokeDasharray="2 4"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}
