import type {
  BotState,
  ConnectionStatus,
  DataQuality,
  EngineState,
  OrderStatus,
  PositionSource,
  ReconciliationState,
  RiskSeverity,
} from "./api/contracts";

export type StatusTone = "profit" | "loss" | "primary" | "warning" | "muted";

export const toneDot: Record<StatusTone, string> = {
  profit: "bg-profit",
  loss: "bg-loss",
  primary: "bg-primary",
  warning: "bg-warning",
  muted: "bg-muted-foreground/50",
};

export const toneText: Record<StatusTone, string> = {
  profit: "text-profit",
  loss: "text-loss",
  primary: "text-primary",
  warning: "text-warning",
  muted: "text-muted-foreground",
};

export const toneChip: Record<StatusTone, string> = {
  profit: "border-profit/30 bg-profit/10 text-profit",
  loss: "border-loss/30 bg-loss/10 text-loss",
  primary: "border-primary/30 bg-primary/10 text-primary",
  warning: "border-warning/30 bg-warning/10 text-warning",
  muted: "border-border bg-muted text-muted-foreground",
};

export function engineStatus(state: EngineState): {
  label: string;
  tone: StatusTone;
} {
  switch (state) {
    case "operational":
      return { label: "Operational", tone: "profit" };
    case "degraded":
      return { label: "Degraded", tone: "primary" };
    case "paused":
      return { label: "Paused", tone: "muted" };
    case "halted":
      return { label: "Halted", tone: "loss" };
    case "offline":
      return { label: "Offline", tone: "loss" };
  }
}

export function connectionStatus(status: ConnectionStatus): {
  label: string;
  tone: StatusTone;
} {
  switch (status) {
    case "connected":
      return { label: "Connected", tone: "profit" };
    case "degraded":
      return { label: "Degraded", tone: "primary" };
    case "disconnected":
      return { label: "Disconnected", tone: "loss" };
    case "not_configured":
      return { label: "Not configured", tone: "muted" };
  }
}

export function botStatus(state: BotState): {
  label: string;
  tone: StatusTone;
} {
  switch (state) {
    case "running":
      return { label: "Running", tone: "profit" };
    case "paused":
      return { label: "Paused", tone: "primary" };
    case "stopped":
      return { label: "Stopped", tone: "muted" };
    case "error":
      return { label: "Error", tone: "loss" };
  }
}

export function orderStatus(status: OrderStatus): {
  label: string;
  tone: StatusTone;
} {
  switch (status) {
    case "open":
      return { label: "Open", tone: "primary" };
    case "partially_filled":
      return { label: "Partial", tone: "primary" };
    case "filled":
      return { label: "Filled", tone: "profit" };
    case "cancelled":
      return { label: "Cancelled", tone: "muted" };
    case "rejected":
      return { label: "Rejected", tone: "loss" };
  }
}

export function reconciliationStatus(state: ReconciliationState): {
  label: string;
  tone: StatusTone;
} {
  switch (state) {
    case "matched":
      return { label: "Matched", tone: "profit" };
    case "pending":
      return { label: "Pending", tone: "primary" };
    case "mismatch":
      return { label: "Mismatch", tone: "loss" };
  }
}

/**
 * Market-data quality. `delayed` is deliberately not green: it is usable for
 * display and never for pricing an order.
 */
export function dataQuality(quality: DataQuality | null | undefined): {
  label: string;
  tone: StatusTone;
} {
  switch (quality) {
    case "live":
      return { label: "Live", tone: "profit" };
    case "delayed":
      return { label: "Delayed", tone: "primary" };
    case "historical":
      return { label: "Historical", tone: "muted" };
    case "simulated":
      return { label: "Simulated", tone: "muted" };
    case "unavailable":
    default:
      return { label: "Unavailable", tone: "loss" };
  }
}

export function positionSource(source: PositionSource | null | undefined): {
  label: string;
  tone: StatusTone;
} {
  return source === "broker_confirmed"
    ? { label: "Broker", tone: "profit" }
    : { label: "Paper", tone: "primary" };
}

export function severityTone(severity: RiskSeverity): StatusTone {
  if (severity === "critical") return "loss";
  if (severity === "warning") return "primary";
  return "muted";
}
