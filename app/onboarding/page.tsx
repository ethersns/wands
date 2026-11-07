import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Logo } from "@/components/marketing/logo";
import { OnboardingFlow } from "@/components/member/onboarding-flow";
import { ensureProfile } from "@/lib/member/profile";
import { requireMember } from "@/lib/member/session";

export const metadata: Metadata = {
  title: "Set up your workspace",
  robots: { index: false, follow: false },
};

export default async function OnboardingPage() {
  const session = await requireMember("/onboarding");
  const profile = await ensureProfile(session.user.id, session.user.name);

  if (profile.onboardingCompleted) {
    redirect("/app");
  }

  return (
    <div className="mk-shell flex min-h-dvh flex-col">
      <header className="px-5 py-5 sm:px-8">
        <Logo href="/app" />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:py-12">
        <OnboardingFlow initialName={profile.displayName ?? session.user.name} />
      </main>
      <footer className="px-5 py-6 text-center font-marketing-mono text-[11px] uppercase tracking-[0.14em] text-mk-dim">
        Research, not advice
      </footer>
    </div>
  );
}
