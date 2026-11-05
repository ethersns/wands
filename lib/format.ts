import type { Currency } from "./api/contracts";

const PLACEHOLDER = "—";

export function formatCurrency(
  value: number | null | undefined,
  currency: Currency = "USD",
  options: { compact?: boolean; digits?: number } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return PLACEHOLDER;
  }
  const { compact = false, digits } = options;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: digits ?? (compact ? 1 : 2),
    minimumFractionDigits: compact ? 0 : (digits ?? 2),
  }).format(value);
}

export function formatNumber(
  value: number | null | undefined,
  options: { digits?: number; compact?: boolean } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return PLACEHOLDER;
  }
  const { digits = 2, compact = false } = options;
  return new Intl.NumberFormat("en-US", {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return PLACEHOLDER;
  }
  const digits = Math.abs(value) >= 100 ? 2 : Math.abs(value) >= 1 ? 3 : 5;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(
  value: number | null | undefined,
  options: { digits?: number; signed?: boolean } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return PLACEHOLDER;
  }
  const { digits = 2, signed = false } = options;
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Math.abs(value));
  const sign = value < 0 ? "−" : signed ? "+" : "";
  return `${sign}${formatted}%`;
}

export function formatSignedCurrency(
  value: number | null | undefined,
  currency: Currency = "USD",
  options: { compact?: boolean } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return PLACEHOLDER;
  }
  const sign = value < 0 ? "−" : "+";
  return `${sign}${formatCurrency(Math.abs(value), currency, options)}`;
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return PLACEHOLDER;
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return PLACEHOLDER;
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return PLACEHOLDER;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return PLACEHOLDER;
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";

  if (abs < 10_000) return "just now";
  if (abs < 60_000) return `${Math.round(abs / 1_000)}s ${suffix}`;
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ${suffix}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ${suffix}`;
  return `${Math.round(abs / 86_400_000)}d ${suffix}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return PLACEHOLDER;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return PLACEHOLDER;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }).format(date);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return PLACEHOLDER;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return PLACEHOLDER;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export type Tone = "profit" | "loss" | "neutral";

export function toneOf(value: number | null | undefined): Tone {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0) {
    return "neutral";
  }
  return value > 0 ? "profit" : "loss";
}

export function toneClass(tone: Tone): string {
  if (tone === "profit") return "text-profit";
  if (tone === "loss") return "text-loss";
  return "text-muted-foreground";
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
