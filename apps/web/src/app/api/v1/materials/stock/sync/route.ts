import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { ok } from "@/lib/http";
import { stockCategories } from "@/lib/consumables";
import { syncStockCandidates } from "@/lib/consumable-stock";
import { displayDepartments } from "@/lib/materials-data";
import { materialHandle } from "@/lib/materials-http";

export const POST = materialHandle(async (req: Request) => {
  const user = await requireUser("admin");
  return ok(await withTransaction((c) => syncStockCandidates(c, displayDepartments(), stockCategories(), user, req)));
});
