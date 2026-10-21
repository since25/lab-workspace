import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { ok } from "@/lib/http";
import { stockCategories } from "@/lib/consumables";
import { initSlotTemplates } from "@/lib/consumable-stock";
import { materialHandle } from "@/lib/materials-http";

// 建立内置槽位模板（只补缺失的，不改已有槽位）。
export const POST = materialHandle(async (req: Request) => {
  const user = await requireUser("admin");
  return ok(await withTransaction((c) => initSlotTemplates(c, stockCategories(), user, req)));
});
