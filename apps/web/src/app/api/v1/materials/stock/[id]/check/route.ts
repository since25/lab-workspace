import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { ok, readJson } from "@/lib/http";
import { checkStock, parseStockId } from "@/lib/consumable-stock";
import { materialHandle } from "@/lib/materials-http";

export const POST = materialHandle(async (req: Request, ctx: RouteContext<"/api/v1/materials/stock/[id]/check">) => {
  const user = await requireUser("admin");
  const id = parseStockId((await ctx.params).id);
  const body = await readJson(req);
  return ok(await withTransaction((c) => checkStock(c, id, body, user, req)));
});
