import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { ok, readJson } from "@/lib/http";
import { decideLink } from "@/lib/consumable-stock";
import { MaterialError } from "@/lib/materials-data";
import { materialHandle } from "@/lib/materials-http";

// 处理一条采购记录：{ action: confirm|exclude|stock|skip, stock_id?, quantity? }；id 为采购记录编号。
export const POST = materialHandle(async (req: Request, ctx: RouteContext<"/api/v1/materials/stock/links/[id]">) => {
  const user = await requireUser("admin");
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new MaterialError("采购记录编号无效");
  const body = await readJson(req);
  return ok(await withTransaction((c) => decideLink(c, id, body, user, req)));
});
