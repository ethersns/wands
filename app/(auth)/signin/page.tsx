import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignInForm } from "@/components/member/auth-forms";
import { getMemberSession } from "@/lib/member/session";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getMemberSession();
  if (session) redirect("/app");

  const { next } = await searchParams;
  return <SignInForm next={next} />;
}
