import { z } from "zod";

import { checkMemberSymbol, MARKET_TYPES, STOCK_SYMBOL_PATTERN } from "@/lib/member/symbols";

export const SYMBOL_PATTERN = STOCK_SYMBOL_PATTERN;

export const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(SYMBOL_PATTERN, "Enter a valid ticker symbol.");

export const watchlistNameSchema = z
  .string()
  .trim()
  .min(1, "Give the watchlist a name.")
  .max(60, "Keep the name under 60 characters.");

export const noteSchema = z.string().trim().max(2000, "Keep notes under 2000 characters.").optional();

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a display name.")
  .max(80, "Keep the name under 80 characters.");

export const createWatchlistSchema = z.object({
  name: watchlistNameSchema,
});

export const renameWatchlistSchema = z.object({
  name: watchlistNameSchema,
});

export const marketTypeSchema = z.enum(MARKET_TYPES);

/**
 * A watchlist entry is a symbol *and* the market it belongs to.
 *
 * `marketType` defaults to `stocks` so every existing caller keeps its exact
 * behaviour: a bare ticker is an equity, and a crypto pair has to be asked for
 * explicitly. The symbol is then normalised by the same rule the engine uses,
 * so what is stored is canonical and `BTC` can never be silently read as
 * `BTC/USD`.
 */
export const addWatchlistItemSchema = z
  .object({
    symbol: z.string().trim().min(1, "Enter a symbol.").max(24, "Keep the symbol under 24 characters."),
    marketType: marketTypeSchema.default("stocks"),
    note: noteSchema,
  })
  .superRefine((value, ctx) => {
    const check = checkMemberSymbol(value.symbol, value.marketType);
    if (!check.ok) {
      ctx.addIssue({ code: "custom", path: ["symbol"], message: check.message });
    }
  })
  .transform((value) => {
    const check = checkMemberSymbol(value.symbol, value.marketType);
    return {
      symbol: check.ok ? check.symbol : value.symbol.trim().toUpperCase(),
      marketType: value.marketType,
      note: value.note,
    };
  });

export const saveItemSchema = z.object({
  kind: z.enum(["signal", "filing", "asset", "insider"]),
  refId: z.string().trim().min(1).max(200),
  symbol: symbolSchema.optional(),
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(2000).optional(),
  note: noteSchema,
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const updateSavedNoteSchema = z.object({
  note: noteSchema,
});

export const notificationPrefsSchema = z.object({
  insiderActivity: z.boolean(),
  institutionalFilings: z.boolean(),
  assetSignals: z.boolean(),
  productUpdates: z.boolean(),
});

export const onboardingSchema = z.object({
  step: z.enum(["welcome", "interests", "watchlist", "done"]).optional(),
  displayName: displayNameSchema.optional(),
  experience: z.enum(["new", "some", "experienced"]).optional(),
  interests: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  seedSymbols: z.array(symbolSchema).max(10).optional(),
  completed: z.boolean().optional(),
});

export const accountUpdateSchema = z.object({
  displayName: displayNameSchema,
});

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "That input is not valid.";
}
