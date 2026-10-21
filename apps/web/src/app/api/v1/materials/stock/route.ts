import { requireUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { ok, readJson } from "@/lib/http";
import { stockCategories } from "@/lib/consumables";
import { createStockItem, listStock } from "@/lib/consumable-stock";
import { displayDepartments } from "@/lib/materials-data";
import { materialHandle } from "@/lib/materials-http";

export const GET = materialHandle(async (req: Request) => {
  await requireUser();
  return ok(await listStock(query, new URL(req.url).searchParams, stockCategories(), displayDepartments()));
});

export const POST = materialHandle(async (req: Request) => {
  const user = await requireUser("admin");
  const body = await readJson(req);
  return ok(await withTransaction((c) => createStockItem(c, body, user, stockCategories(), req)), 201);
});
