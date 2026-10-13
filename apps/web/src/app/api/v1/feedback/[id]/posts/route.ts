import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { markRead, parseBody, visibleThread } from "@/lib/feedback";
import { handle, ok, readJson } from "@/lib/http";

// 回复：发起人和管理员都可以回复（已解决的留言也可以继续回复）
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/v1/feedback/[id]/posts">) => {
  const user = await requireUser();
  const t = await visibleThread(user, Number((await ctx.params).id));
  const body = parseBody((await readJson(req)).body);
  const id = await withTransaction(async (c) => {
    const r = await c.query<{ id: number }>(
      "INSERT INTO feedback_posts(thread_id, author_id, body) VALUES ($1, $2, $3) RETURNING id",
      [t.id, user.id, body]
    );
    await c.query("UPDATE feedback_threads SET last_post_at = now(), updated_at = now() WHERE id = $1", [t.id]);
    return r.rows[0].id;
  });
  await markRead(user.id, t.id);
  return ok({ id }, 201);
});
