import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { markRead, visibleThread } from "@/lib/feedback";
import { HttpError, handle, ok, readJson, str } from "@/lib/http";

// 留言详情（含全部回复）；打开即标记为已读
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/v1/feedback/[id]">) => {
  const user = await requireUser();
  const t = await visibleThread(user, Number((await ctx.params).id));
  const [thread] = await query(
    `SELECT t.id, t.title, t.status, t.created_at, t.author_id, u.display_name AS author_name
       FROM feedback_threads t JOIN users u ON u.id = t.author_id WHERE t.id = $1`,
    [t.id]
  );
  const posts = await query(
    `SELECT p.id, p.body, p.created_at, p.author_id, u.display_name AS author_name, (u.role = 'admin') AS by_admin
       FROM feedback_posts p LEFT JOIN users u ON u.id = p.author_id
      WHERE p.thread_id = $1 ORDER BY p.created_at, p.id`,
    [t.id]
  );
  await markRead(user.id, t.id);
  return ok({ thread, posts });
});

// 标记已解决 / 重新打开：{status: "open" | "closed"}，仅管理员
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/v1/feedback/[id]">) => {
  const user = await requireUser("admin");
  const t = await visibleThread(user, Number((await ctx.params).id));
  const status = str((await readJson(req)).status);
  if (status !== "open" && status !== "closed") throw new HttpError(400, "状态只能是待处理或已解决");
  if (status !== t.status) {
    await query("UPDATE feedback_threads SET status = $2, updated_at = now() WHERE id = $1", [t.id, status]);
    await audit(user.id, "feedback.status", "feedback", t.id, { from: t.status, to: status }, req);
  }
  return ok({ ok: true });
});
