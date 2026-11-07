import type { InsiderTransactionClass, ResearchSignalCategory } from "@/lib/api/contracts";

/**
 * One label map per contract enum, shared by feeds, detail views and saved
 * items, so the same record never reads differently in two places.
 */

export const SIGNAL_LABEL: Record<ResearchSignalCategory, string> = {
  INSIDER_PURCHASE_CLUSTER: "Insider purchase cluster",
  INSIDER_PURCHASE_VALUE: "Insider purchase value",
  INSIDER_ACTIVITY_CHANGE: "Insider activity change",
  INSIDER_SELLING_CLUSTER: "Insider selling cluster",
  INSTITUTIONAL_POSITION_CHANGE: "Institutional position change",
  MARKET_TREND: "Market trend",
  VOLUME_ANOMALY: "Volume anomaly",
};

export const TRANSACTION_CLASS_LABEL: Record<InsiderTransactionClass, string> = {
  open_market_purchase: "Open-market buy",
  open_market_sale: "Open-market sale",
  award_grant: "Award / grant",
  tax_withholding: "Tax withholding",
  gift: "Gift",
  derivative_exercise: "Derivative exercise",
  disposition_to_issuer: "Disposition to issuer",
  other: "Other",
};
