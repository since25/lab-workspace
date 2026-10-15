import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { ok, readJson } from "@/lib/http";
import { changeMaterialUsage, displayDepartments, materialIds, parseUsageAction } from "@/lib/materials-data";
import { materialHandle } from "@/lib/materials-http";

export const POST = materialHandle(async (req: Request, ctx: RouteContext<"/api/v1/materials/[id]/usage">) => {
  const user = await requireUser();
  const body = await readJson(req);
  const action = parseUsageAction(body, user.role);
  const ids = materialIds([Number((await ctx.params).id)]);
  const result = await withTransaction(c => changeMaterialUsage(c, user, ids, action, displayDepartments(), req));
  return ok(result);
});
