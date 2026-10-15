import { requireUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { ok, readJson } from "@/lib/http";
import { changeMaterialUsage, displayDepartments, materialIds, MaterialError, parseUsageAction } from "@/lib/materials-data";
import { materialHandle } from "@/lib/materials-http";
import { listUsageRequests } from "@/lib/materials-list";

export const GET = materialHandle(async (req: Request) => {
  await requireUser("admin");
  return ok(await listUsageRequests(query, new URL(req.url).searchParams, displayDepartments()));
});

export const POST = materialHandle(async (req: Request) => {
  const user = await requireUser("admin");
  const body = await readJson(req);
  const action = parseUsageAction(body, user.role);
  if (action !== "approve" && action !== "reject") throw new MaterialError("请选择批准或驳回申请");
  const ids = materialIds(body.ids);
  return ok(await withTransaction(c => changeMaterialUsage(c, user, ids, action, displayDepartments(), req)));
});
