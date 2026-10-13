import { requireUser } from "@/lib/auth";
import { unreadCount } from "@/lib/feedback";
import { handle, ok } from "@/lib/http";

// 导航栏角标：有未读回复的留言条数
export const GET = handle(async () => {
  const user = await requireUser();
  return ok({ count: await unreadCount(user) });
});
