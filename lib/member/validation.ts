import { z } from "zod";

export const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

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

export const addWatchlistItemSchema = z.object({
  symbol: symbolSchema,
  note: noteSchema,
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

export const alertRuleKindSchema = z.enum(["insider_purchase", "insider_sale", "signal"]);

const alertValueSchema = z
  .number()
  .min(0, "A dollar threshold cannot be negative.")
  .max(1_000_000_000_000, "That threshold is too large.")
  .nullable();

const alertScoreSchema = z
  .number()
  .int("Use a whole number for a score.")
  .min(0, "A score runs from 0 to 100.")
  .max(100, "A score runs from 0 to 100.")
  .nullable();

export const createAlertRuleSchema = z
  .object({
    kind: alertRuleKindSchema,
    symbol: symbolSchema.nullish(),
    minValue: alertValueSchema.optional(),
    minScore: alertScoreSchema.optional(),
  })
  .superRefine((value, ctx) => {
    // A threshold on the wrong axis is a mistake, not a value to ignore: a
    // member who typed a dollar floor into a signal rule would otherwise get a
    // rule that silently watches everything.
    if (value.kind === "signal" && value.minValue !== undefined && value.minValue !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["minValue"],
        message: "A research-signal rule uses a score, not a dollar value.",
      });
    }
    if (value.kind !== "signal" && value.minScore !== undefined && value.minScore !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["minScore"],
        message: "An insider rule uses a dollar value, not a score.",
      });
    }
  });

export const updateAlertRuleSchema = z
  .object({
    enabled: z.boolean().optional(),
    minValue: alertValueSchema.optional(),
    minScore: alertScoreSchema.optional(),
  })
  .refine(
    (value) => value.enabled !== undefined || value.minValue !== undefined || value.minScore !== undefined,
    { message: "Nothing to update." },
  );

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
