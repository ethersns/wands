import type { Metadata } from "next";

import { SavedList } from "@/components/member/saved-list";
import { PageHeader } from "@/components/member/ui";
import { getMembership } from "@/lib/member/membership";
import { listSaved } from "@/lib/member/saved";
import { requireMember } from "@/lib/member/session";

export const metadata: Metadata = { title: "Saved research" };

export default async function SavedPage() {
  const session = await requireMember("/app/saved");
  const userId = session.user.id;

  const [items, membership] = await Promise.all([listSaved(userId), getMembership(userId)]);

  return (
    <div>
      <PageHeader
        eyebrow="Library"
        title="Saved research"
        description={`Signals, filings and assets you kept, with your own notes. ${items.length} of ${membership.limits.savedItems} saved on the ${membership.label} plan.`}
      />
      <SavedList initial={items} />
    </div>
  );
}
