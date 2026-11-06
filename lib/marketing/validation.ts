import { z } from "zod";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const emailField = z
  .string()
  .trim()
  .min(3, "Enter your email address.")
  .max(254, "That email address is too long.")
  .refine((value) => EMAIL_PATTERN.test(value), "That email address does not look right.");

const honeypotField = z.string().max(200).optional().nullable();

export const waitlistInput = z.object({
  email: emailField,
  role: z.string().trim().max(80).optional().nullable(),
  source: z.string().trim().max(64).optional().nullable(),
  companyWebsite: honeypotField,
});

export const contactInput = z.object({
  name: z.string().trim().min(1, "Tell us your name.").max(120, "That name is too long."),
  email: emailField,
  topic: z.string().trim().max(80).optional().nullable(),
  message: z
    .string()
    .trim()
    .min(10, "Add a little more detail so we can route this properly.")
    .max(5000, "That message is too long. Please trim it to 5000 characters."),
  companyWebsite: honeypotField,
});

export type WaitlistInput = z.infer<typeof waitlistInput>;
export type ContactInput = z.infer<typeof contactInput>;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "That submission could not be validated.";
}

export function isHoneypotFilled(value: string | null | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}
