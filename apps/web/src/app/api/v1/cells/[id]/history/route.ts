import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, ok } from "@/lib/http";

// 某条细胞记录的修改历史（来自审计日志）
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/v1/cells/[id]/history">) => {
  await requireUser();
  const { id } = await ctx.params;
  const history = await query(
    `SELECT a.id, a.action, a.metadata_json, a.created_at, u.display_name AS actor
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.resource_type = 'cell' AND a.resource_id = $1
      ORDER BY a.created_at DESC, a.id DESC`,
    [id]
  );
  return ok({ history });
});
