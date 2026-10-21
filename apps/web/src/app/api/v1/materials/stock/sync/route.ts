import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { ok } from "@/lib/http";
import { matchPurchases } from "@/lib/consumable-stock";
import { displayDepartments } from "@/lib/materials-data";
import { materialHandle } from "@/lib/materials-http";

// 匹配采购记录：把展示部门里新出现的采购挂到槽位（已知货号直接归入，其余给建议等管理员确认）。
export const POST = materialHandle(async (req: Request) => {
  const user = await requireUser("admin");
  return ok(await withTransaction((c) => matchPurchases(c, displayDepartments(), user, req)));
});
