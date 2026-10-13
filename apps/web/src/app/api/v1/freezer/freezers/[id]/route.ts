import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { parseFreezerInput } from "@/lib/freezer-server";
import { HttpError, handle, ok, readJson } from "@/lib/http";

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/v1/freezer/freezers/[id]">) => {
  const user = await requireUser("admin");
  const id = Number((await ctx.params).id);
  const f = parseFreezerInput(await readJson(req));
  const [dup] = await query("SELECT 1 FROM freezers WHERE name = $1 AND id <> $2", [f.name, id]);
  if (dup) throw new HttpError(409, "已有同名冰箱");
  const rows = await query(
    `UPDATE freezers SET name = $2, temperature = $3, location = $4, remarks = $5, is_active = $6, updated_at = now()
      WHERE id = $1 RETURNING id`,
    [id, f.name, f.temperature, f.location, f.remarks, f.is_active]
  );
  if (!rows.length) throw new HttpError(404, "冰箱不存在");
  await audit(user.id, "freezer.update", "freezer", id, f, req);
  return ok({ ok: true });
});

// 只能删除没有任何容器的冰箱；有容器的请改为停用
export const DELETE = handle(async (req: Request, ctx: RouteContext<"/api/v1/freezer/freezers/[id]">) => {
  const user = await requireUser("admin");
  const id = Number((await ctx.params).id);
  const [used] = await query("SELECT 1 FROM freezer_containers WHERE freezer_id = $1 LIMIT 1", [id]);
  if (used) throw new HttpError(409, "该冰箱里还登记有容器，不能删除，可改为停用");
  const rows = await query<{ name: string }>("DELETE FROM freezers WHERE id = $1 RETURNING name", [id]);
  if (!rows.length) throw new HttpError(404, "冰箱不存在");
  await audit(user.id, "freezer.delete", "freezer", id, { name: rows[0].name }, req);
  return ok({ ok: true });
});
