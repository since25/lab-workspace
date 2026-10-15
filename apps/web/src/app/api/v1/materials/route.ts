import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { ok } from "@/lib/http";
import { displayDepartments } from "@/lib/materials-data";
import { materialHandle } from "@/lib/materials-http";
import { listMaterials } from "@/lib/materials-list";

export const GET = materialHandle(async (req: Request) => {
  await requireUser();
  return ok(await listMaterials(query, new URL(req.url).searchParams, displayDepartments()));
});
