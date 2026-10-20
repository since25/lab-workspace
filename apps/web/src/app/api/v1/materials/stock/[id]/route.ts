import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { ok, readJson } from "@/lib/http";
import { stockCategories } from "@/lib/consumables";
import { deleteStockItem, parseStockId, updateStockItem } from "@/lib/consumable-stock";
import { materialHandle } from "@/lib/materials-http";

export const PATCH = materialHandle(async (req: Request, ctx: RouteContext<"/api/v1/materials/stock/[id]">) => {
  const user = await requireUser("admin");
  const id = parseStockId((await ctx.params).id);
  const body = await readJson(req);
  return ok(await withTransaction((c) => updateStockItem(c, id, body, user, stockCategories(), req)));
});

export const DELETE = materialHandle(async (req: Request, ctx: RouteContext<"/api/v1/materials/stock/[id]">) => {
  const user = await requireUser("admin");
  const id = parseStockId((await ctx.params).id);
  return ok(await withTransaction((c) => deleteStockItem(c, id, user, req)));
});
