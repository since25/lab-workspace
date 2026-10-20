import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { ok } from "@/lib/http";
import { getReconcileRequest, parseReconcileId } from "@/lib/stock-reconcile";
import { materialHandle } from "@/lib/materials-http";

export const GET = materialHandle(async (_req: Request, ctx: RouteContext<"/api/v1/materials/reconcile/[id]">) => {
  const user = await requireUser();
  const id = parseReconcileId((await ctx.params).id);
  return ok(await getReconcileRequest(query, id, user));
});
