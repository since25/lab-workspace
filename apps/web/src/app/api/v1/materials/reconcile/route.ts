import { requireUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { ok, readJson } from "@/lib/http";
import { createReconcileRequest, listReconcileRequests } from "@/lib/stock-reconcile";
import { displayDepartments } from "@/lib/materials-data";
import { materialHandle } from "@/lib/materials-http";

export const GET = materialHandle(async (req: Request) => {
  const user = await requireUser();
  return ok(await listReconcileRequests(query, new URL(req.url).searchParams, user));
});

export const POST = materialHandle(async (req: Request) => {
  const user = await requireUser();
  const body = await readJson(req);
  return ok(await withTransaction((c) => createReconcileRequest(c, body, user, displayDepartments(), req)), 201);
});
