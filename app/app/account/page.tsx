import type { Metadata } from "next";

import { DeleteAccountForm, PreferencesForm, ProfileForm } from "@/components/member/account-forms";
import { Badge, PageHeader, Panel } from "@/components/member/ui";
import { getPrefs } from "@/lib/member/notifications";
import { ensureProfile } from "@/lib/member/profile";
import { requireMember } from "@/lib/member/session";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const session = await requireMember("/app/account");
  const userId = session.user.id;

  const [profile, prefs] = await Promise.all([ensureProfile(userId, session.user.name), getPrefs(userId)]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Settings" title="Account" description="Your profile, alerts and account controls." />

      <Panel title="Profile">
        <ProfileForm initialName={profile.displayName ?? session.user.name} />
      </Panel>

      <Panel title="Email">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-mk-fg">{session.user.email}</p>
            <p className="mt-0.5 text-xs text-mk-muted">
              {session.user.emailVerified
                ? "This address is confirmed."
                : "This address is not confirmed. Email delivery is not configured, so no confirmation message is sent."}
            </p>
          </div>
          <Badge tone={session.user.emailVerified ? "emerald" : "warn"}>
            {session.user.emailVerified ? "Verified" : "Unverified"}
          </Badge>
        </div>
      </Panel>

      <Panel title="Notification preferences">
        <PreferencesForm initial={prefs} />
      </Panel>

      <Panel title="Delete account">
        <DeleteAccountForm />
      </Panel>
    </div>
  );
}
