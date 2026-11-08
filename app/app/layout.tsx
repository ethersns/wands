import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MemberShell } from "@/components/member/member-shell";
import { isFounderUserId } from "@/lib/auth/founder";
import { ensureMembership } from "@/lib/member/membership";
import { unreadCount } from "@/lib/member/notifications";
import { ensureProfile } from "@/lib/member/profile";
import { requireMemberAccess } from "@/lib/member/session";

export const metadata: Metadata = {
  title: "Workspace",
  robots: { index: false, follow: false },
};

/**
 * The workspace shell.
 *
 * `requireMemberAccess` is the paid gate: a session alone is not enough to
 * render anything under `/app`. The billing surface is exempt so a lapsed
 * member can reach the page that fixes it, and the middleware tells this layout
 * which request it is rendering.
 */
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const { session } = await requireMemberAccess();

  const [profile, membership, unread] = await Promise.all([
    ensureProfile(session.user.id, session.user.name),
    ensureMembership(session.user.id),
    unreadCount(session.user.id),
  ]);

  if (!profile.onboardingCompleted) {
    redirect("/onboarding");
  }

  return (
    <MemberShell
      name={profile.displayName ?? session.user.name}
      email={session.user.email}
      planLabel={membership.label}
      unread={unread}
      founder={isFounderUserId(session.user.id)}
    >
      {children}
    </MemberShell>
  );
}
