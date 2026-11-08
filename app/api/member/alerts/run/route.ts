import { handleMemberRoute, requireEntitledMemberApi } from "@/lib/member/api";
import { runAlertSweep } from "@/lib/member/alerts";

/**
 * Runs the member's enabled rules once and reports what happened.
 *
 * A POST rather than a GET because it writes: a sweep creates notifications and
 * delivery records. It is safe to repeat — the delivery ledger makes a second
 * run a no-op for events already reported.
 */
export async function POST() {
  return handleMemberRoute(async () => {
    const { userId } = await requireEntitledMemberApi();
    return { sweep: await runAlertSweep(userId) };
  });
}
