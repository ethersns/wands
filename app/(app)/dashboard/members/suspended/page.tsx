import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { AccountStatusBadge } from "@/components/admin/account-status-badge";
import { MemberActions } from "@/components/admin/member-actions";
import { MemberTabs } from "@/components/admin/member-tabs";
import { AdminPagination } from "@/components/admin/pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireOperator } from "@/lib/admin/guard";
import { listMembers } from "@/lib/admin/members";
import { formatDate, formatRelative } from "@/lib/format";

export const metadata: Metadata = {
  title: "Suspended accounts",
};

export const dynamic = "force-dynamic";

export default async function SuspendedMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireOperator("/dashboard/members/suspended");

  const params = await searchParams;
  const page = Number(params.page ?? "1");

  const result = await listMembers({
    accountStatus: "suspended",
    page: Number.isFinite(page) ? page : 1,
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Suspended accounts"
        description="Accounts that cannot sign in. Suspension is enforced at the authentication layer and revokes every active session; the account's data is preserved for reactivation."
      />

      <MemberTabs />

      <SectionCard
        title={`${result.total} suspended account${result.total === 1 ? "" : "s"}`}
        description="Reactivating restores sign-in. Nothing was removed, so nothing is restored."
        bodyClassName="px-0 pb-0 sm:px-0"
        footer={
          result.total > 0 ? (
            <AdminPagination
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              pageSize={result.pageSize}
              basePath="/dashboard/members/suspended"
              params={{}}
            />
          ) : undefined
        }
      >
        {result.rows.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={ShieldCheck}
              title="No suspended accounts"
              description="Every registered account can currently sign in."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Suspended</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead className="sticky right-0 z-10 border-l border-border bg-card text-right">
                    Controls
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/members/${member.id}`}
                        className="flex flex-col gap-0.5 hover:underline"
                      >
                        <span className="text-[12px] font-medium text-foreground">
                          {member.display_name || member.name || member.email}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {member.email}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <AccountStatusBadge status={member.account_status} />
                    </TableCell>
                    <TableCell className="text-[11px] whitespace-nowrap text-muted-foreground">
                      {member.suspended_at ? formatRelative(member.suspended_at) : "Not recorded"}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                      {formatDate(member.created_at)}
                    </TableCell>
                    <TableCell className="sticky right-0 z-10 border-l border-border bg-card">
                      <div className="flex justify-end">
                        <MemberActions
                          userId={member.id}
                          email={member.email}
                          status={member.account_status}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
