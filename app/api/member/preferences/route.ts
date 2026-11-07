import { handleMemberRoute, readJson, requireMemberApi } from "@/lib/member/api";
import { getPrefs, updatePrefs } from "@/lib/member/notifications";
import { notificationPrefsSchema } from "@/lib/member/validation";

export async function GET() {
  return handleMemberRoute(async () => {
    const { userId } = await requireMemberApi();
    return { prefs: await getPrefs(userId) };
  });
}

export async function PATCH(request: Request) {
  return handleMemberRoute(async () => {
    const { userId } = await requireMemberApi();
    const prefs = notificationPrefsSchema.parse(await readJson(request));
    return { prefs: await updatePrefs(userId, prefs) };
  });
}
