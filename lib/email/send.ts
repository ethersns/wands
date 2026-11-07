import { Resend } from "resend";

export const emailDeliveryConfigured = Boolean(process.env.RESEND_API_KEY);

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendResult = { delivered: boolean };

export async function sendTransactionalEmail({ to, subject, html, text }: SendArgs): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[wands] email delivery is not configured; transactional email was not sent", { subject });
    return { delivered: false };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.WANDS_EMAIL_FROM ?? "Wands <onboarding@resend.dev>";

  try {
    const { error } = await resend.emails.send({ from, to, subject, html, text });
    if (error) {
      console.error("[wands] transactional email failed", { subject, error: error.message });
      return { delivered: false };
    }
    return { delivered: true };
  } catch (error) {
    console.error("[wands] transactional email threw", {
      subject,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { delivered: false };
  }
}

export function verificationEmail(url: string) {
  return {
    subject: "Confirm your Wands email",
    text: `Confirm your email to finish setting up your Wands workspace:\n\n${url}\n\nIf you did not create a Wands account you can ignore this message.`,
    html: `<p>Confirm your email to finish setting up your Wands workspace.</p><p><a href="${url}">Confirm email</a></p><p>If you did not create a Wands account you can ignore this message.</p>`,
  };
}

export function passwordResetEmail(url: string) {
  return {
    subject: "Reset your Wands password",
    text: `Use this link to choose a new password:\n\n${url}\n\nIf you did not request this you can ignore this message.`,
    html: `<p>Use this link to choose a new password.</p><p><a href="${url}">Reset password</a></p><p>If you did not request this you can ignore this message.</p>`,
  };
}
