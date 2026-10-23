import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, HttpError, ok, readJson, str } from "@/lib/http";

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/v1/admin/printers/[id]">) => {
  const admin = await requireUser("admin");
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "打印机编号无效");
  const body = await readJson(req);
  const sets: string[] = [];
  const values: unknown[] = [id];
  const meta: Record<string, unknown> = {};
  if (body.name !== undefined) { const name = str(body.name); if (!name || name.length > 120) throw new HttpError(400, "打印机名称不能为空且不能超过 120 字"); values.push(name); sets.push(`name=$${values.length}`); meta.name = name; }
  for (const key of ["enabled", "is_default"] as const) if (typeof body[key] === "boolean") { values.push(body[key]); sets.push(`${key}=$${values.length}`); meta[key] = body[key]; }
  if (!sets.length) throw new HttpError(400, "没有要修改的内容");
  if (body.is_default === true) await query("UPDATE label_printers SET is_default=false, updated_at=now() WHERE id <> $1", [id]);
  const [printer] = await query<{ id: number; printer_key: string; name: string; enabled: boolean; is_default: boolean }>(`UPDATE label_printers SET ${sets.join(",")}, updated_at=now() WHERE id=$1 RETURNING id,printer_key,name,enabled,is_default`, values);
  if (!printer) throw new HttpError(404, "打印机不存在");
  await audit(admin.id, "admin.printer_update", "label_printer", id, meta, req);
  return ok({ printer });
});
