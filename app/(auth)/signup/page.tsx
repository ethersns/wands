import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignUpForm } from "@/components/member/auth-forms";
import { emailDeliveryConfigured } from "@/lib/email/send";
import { getMemberSession } from "@/lib/member/session";

export const metadata: Metadata = {
  title: "Create your account",
  robots: { index: false, follow: false },
};

export default async function SignUpPage() {
  const session = await getMemberSession();
  if (session) redirect("/app");

  return <SignUpForm requiresVerification={emailDeliveryConfigured} />;
}
