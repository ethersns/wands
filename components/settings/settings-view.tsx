"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/shared/section-card";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { engineMutation } from "@/lib/api/browser";
import type { Currency, UserSettings } from "@/lib/api/contracts";
import { formatDateTime } from "@/lib/format";

const CURRENCIES: Currency[] = ["USD", "EUR", "GBP", "JPY", "AUD", "CHF"];

const NOTIFICATIONS: {
  key: keyof UserSettings["notifications"];
  label: string;
  help: string;
}[] = [
  { key: "tradeFills", label: "Trade fills", help: "Notify when an order is fully or partially filled." },
  { key: "riskBreaches", label: "Risk breaches", help: "Notify when a limit is breached or a circuit breaker trips." },
  { key: "engineOffline", label: "Engine offline", help: "Notify when the engine heartbeat stops." },
  { key: "dailySummary", label: "Daily summary", help: "A once-daily digest of P&L, exposure and bot activity." },
];

export function SettingsView({ settings }: { settings: UserSettings }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [draft, setDraft] = React.useState<UserSettings>(settings);
  const [saving, setSaving] = React.useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  async function save() {
    setSaving(true);
    const result = await engineMutation<UserSettings>("settings", {
      method: "PATCH",
      body: draft,
    });
    setSaving(false);

    if (!result.ok) {
      toast.error("Settings not saved", {
        description: result.error.message,
        duration: 9_000,
      });
      return;
    }

    toast.success("Settings saved");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </p>
        <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
          <Save className="size-3.5" aria-hidden />
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Profile"
          description="How this operator is identified in the audit log"
          bodyClassName="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-name">Display name</Label>
            <Input
              id="settings-name"
              value={draft.displayName}
              onChange={(event) =>
                setDraft((current) => ({ ...current, displayName: event.target.value }))
              }
              maxLength={60}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-email">Email</Label>
            <Input
              id="settings-email"
              type="email"
              value={draft.email}
              onChange={(event) =>
                setDraft((current) => ({ ...current, email: event.target.value }))
              }
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Display"
          description="Appearance and reporting currency"
          bodyClassName="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-theme">Theme</Label>
            <Select
              value={draft.theme}
              onValueChange={(value) => {
                const theme = value as UserSettings["theme"];
                setDraft((current) => ({ ...current, theme }));
                setTheme(theme);
              }}
            >
              <SelectTrigger id="settings-theme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-currency">Base currency</Label>
            <Select
              value={draft.baseCurrency}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  baseCurrency: value as Currency,
                }))
              }
            >
              <SelectTrigger id="settings-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((currency) => (
                  <SelectItem key={currency} value={currency}>
                    {currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Reporting currency only. The engine converts at execution-time rates.
            </p>
          </div>
        </SectionCard>

        <SectionCard
          title="Notifications"
          description="What the engine should alert you about"
          bodyClassName="flex flex-col divide-y divide-border"
        >
          {NOTIFICATIONS.map((item) => (
            <div
              key={item.key}
              className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-foreground">{item.label}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {item.help}
                </p>
              </div>
              <Switch
                checked={draft.notifications[item.key]}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({
                    ...current,
                    notifications: { ...current.notifications, [item.key]: checked },
                  }))
                }
                aria-label={item.label}
              />
            </div>
          ))}
        </SectionCard>

        <SectionCard
          title="Security"
          description="Access control for this terminal"
          bodyClassName="flex flex-col gap-3"
        >
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface/60 p-3">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-foreground">
                Two-factor authentication
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                Enrolment is completed on the engine, which issues the TOTP secret.
              </p>
            </div>
            <StatusChip
              label={draft.twoFactorEnabled ? "Enabled" : "Not enrolled"}
              tone={draft.twoFactorEnabled ? "profit" : "muted"}
            />
          </div>
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface/60 p-3">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-foreground">Session</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                Server-side session with an httpOnly cookie. No credentials are kept
                in browser storage.
              </p>
            </div>
            <StatusChip label="Active" tone="profit" />
          </div>
        </SectionCard>

        <SectionCard
          title="Cloud engine"
          description="Where trading operations run"
          bodyClassName="flex flex-col gap-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Endpoint</span>
            <StatusChip
              label={draft.engine.endpointConfigured ? "Configured" : "Not configured"}
              tone={draft.engine.endpointConfigured ? "profit" : "muted"}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Region</span>
            <span className="font-mono text-[12px] text-foreground">
              {draft.engine.region}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Heartbeat</span>
            <span className="font-mono text-[12px] text-foreground">
              {draft.engine.heartbeatSeconds}s
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            The endpoint and token are server-side environment variables
            (WANDS_ENGINE_URL, WANDS_ENGINE_TOKEN). They are never exposed to the
            browser.
          </p>
        </SectionCard>

        <SectionCard
          title="Backup & audit"
          description="Retention for trading records"
          bodyClassName="flex flex-col gap-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Last backup</span>
            <span className="font-mono text-[11px] text-foreground">
              {draft.audit.lastBackupAt
                ? formatDateTime(draft.audit.lastBackupAt)
                : "never"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Retention</span>
            <span className="font-mono text-[12px] text-foreground">
              {draft.audit.retentionDays} days
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            Orders, fills and risk events are append-only. Backups are taken by the
            engine on its own schedule.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
