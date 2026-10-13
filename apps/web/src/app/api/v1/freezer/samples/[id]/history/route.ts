import { canViewAllFreezer, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { HttpError, handle, ok } from "@/lib/http";

// 某管样品的流转历史（存入、修改、转移、取出），来自审计日志；本人、管理员、有「冰箱总览」权限者，
// 以及样品在公共容器里时所有人可看
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/v1/freezer/samples/[id]/history">) => {
  const user = await requireUser();
  const id = Number((await ctx.params).id);
  const [s] = await query<{ owner_id: number; is_shared: boolean | null }>(
    `SELECT s.owner_id, ct.is_shared FROM freezer_samples s LEFT JOIN freezer_containers ct ON ct.id = s.container_id WHERE s.id = $1`,
    [id]
  );
  if (!s || (s.owner_id !== user.id && !s.is_shared && !canViewAllFreezer(user))) throw new HttpError(404, "样品不存在");
  const history = await query(
    `SELECT a.id, a.action, a.metadata_json, a.created_at, u.display_name AS actor
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.resource_type = 'freezer_sample' AND a.resource_id = $1
      ORDER BY a.created_at DESC, a.id DESC`,
    [String(id)]
  );
  return ok({ history });
});
