import { handleMemberRoute, requireMemberApi } from "@/lib/member/api";
import { listNotifications, markAllRead, unreadCount } from "@/lib/member/notifications";

export async function GET() {
  return handleMemberRoute(async () => {
    const { userId } = await requireMemberApi();
    const [items, unread] = await Promise.all([listNotifications(userId), unreadCount(userId)]);
    return { items, unread };
  });
}

export async function PATCH() {
  return handleMemberRoute(async () => {
    const { userId } = await requireMemberApi();
    const marked = await markAllRead(userId);
    return { marked };
  });
}
