import type { Metadata } from "next";

import { DataNotice } from "@/components/shared/data-notice";
import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { SettingsView } from "@/components/settings/settings-view";
import { getSettings } from "@/lib/api/endpoints";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const settings = await getSettings();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={<ProvenanceBadge provenance={settings.provenance} />}
        title="Settings"
        description="Profile, security, notifications and the cloud engine that runs your trading operations."
      />

      <DataNotice envelope={settings} compact />

      <SettingsView settings={settings.data} />
    </div>
  );
}
