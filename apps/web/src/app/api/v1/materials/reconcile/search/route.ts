import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { ok } from "@/lib/http";
import { stockCategories } from "@/lib/consumables";
import { searchReconcileContext } from "@/lib/stock-reconcile";
import { displayDepartments } from "@/lib/materials-data";
import { materialHandle } from "@/lib/materials-http";

export const GET = materialHandle(async (req: Request) => {
  await requireUser();
  return ok(await searchReconcileContext(query, new URL(req.url).searchParams, stockCategories(), displayDepartments()));
});
