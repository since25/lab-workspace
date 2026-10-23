import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, HttpError, ok, readJson, str } from "@/lib/http";

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/v1/admin/tenants/[id]">) => {
  const admin = await requireUser("admin");
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "租户编号无效");
  const body = await readJson(req);
  const sets: string[] = [];
  const values: unknown[] = [id];
  const meta: Record<string, unknown> = {};
  if (body.name !== undefined) { const name = str(body.name); if (!name || name.length > 100) throw new HttpError(400, "租户名称不能为空且不能超过 100 字"); values.push(name); sets.push(`name=$${values.length}`); meta.name = name; }
  if (typeof body.is_active === "boolean") { values.push(body.is_active); sets.push(`is_active=$${values.length}`); meta.is_active = body.is_active; }
  if (typeof body.label_print_enabled === "boolean") { values.push(body.label_print_enabled); sets.push(`label_print_enabled=$${values.length}`); meta.label_print_enabled = body.label_print_enabled; }
  if (!sets.length) throw new HttpError(400, "没有要修改的内容");
  const [tenant] = await query<{ id: number; slug: string; name: string; is_active: boolean; label_print_enabled: boolean }>(`UPDATE tenants SET ${sets.join(",")}, updated_at=now() WHERE id=$1 RETURNING id,slug,name,is_active,label_print_enabled`, values);
  if (!tenant) throw new HttpError(404, "租户不存在");
  await audit(admin.id, "admin.tenant_update", "tenant", id, meta, req);
  return ok({ tenant });
});
