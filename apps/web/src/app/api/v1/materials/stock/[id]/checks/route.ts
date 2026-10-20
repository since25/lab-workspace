import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { ok } from "@/lib/http";
import { listChecks, parseStockId } from "@/lib/consumable-stock";
import { materialHandle } from "@/lib/materials-http";

export const GET = materialHandle(async (req: Request, ctx: RouteContext<"/api/v1/materials/stock/[id]/checks">) => {
  await requireUser();
  const id = parseStockId((await ctx.params).id);
  const limit = Number(new URL(req.url).searchParams.get("limit")) || 10;
  return ok({ items: await listChecks(query, id, limit) });
});
