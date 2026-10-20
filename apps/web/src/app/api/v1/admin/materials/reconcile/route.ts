import { requireUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { ok, readJson } from "@/lib/http";
import { listReconcileRequests, reviewReconcileRequests } from "@/lib/stock-reconcile";
import { materialHandle } from "@/lib/materials-http";

export const GET = materialHandle(async (req: Request) => {
  const user = await requireUser("admin");
  return ok(await listReconcileRequests(query, new URL(req.url).searchParams, user));
});

export const POST = materialHandle(async (req: Request) => {
  const user = await requireUser("admin");
  const body = await readJson(req);
  return ok(await withTransaction((c) => reviewReconcileRequests(c, body.ids, body.action, user, body.note, req)));
});
