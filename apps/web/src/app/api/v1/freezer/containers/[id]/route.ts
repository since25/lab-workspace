import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { checkContainerPlace, ownContainer, parseContainerInput } from "@/lib/freezer-server";
import { HttpError, handle, ok, readJson } from "@/lib/http";

const FIELDS = ["freezer_id", "kind", "name", "shelf_no", "rack_no", "slot_no", "remarks"] as const;

// 修改自己的容器（含搬到别的冰箱/层/架）；容器里的样品随之一起移动
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/v1/freezer/containers/[id]">) => {
  const user = await requireUser();
  const id = Number((await ctx.params).id);
  const input = parseContainerInput(await readJson(req));
  const warning = await withTransaction(async (c) => {
    const old = await ownContainer(c, user, id);
    const changes: Record<string, [unknown, unknown]> = {};
    for (const k of FIELDS) {
      if (String(old[k] ?? "") !== String(input[k] ?? "")) changes[k] = [old[k] ?? null, input[k]];
    }
    if (!Object.keys(changes).length) return "";
    const w = await checkContainerPlace(c, input, id);
    await c.query(
      `UPDATE freezer_containers SET freezer_id = $2, kind = $3, name = $4, shelf_no = $5, rack_no = $6, slot_no = $7,
         remarks = $8, updated_at = now() WHERE id = $1`,
      [id, input.freezer_id, input.kind, input.name, input.shelf_no, input.rack_no, input.slot_no, input.remarks]
    );
    await audit(user.id, "freezer_container.update", "freezer_container", id, { changes }, req, c);
    return w;
  });
  return ok({ ok: true, warning });
});

// 只能删除没有在库样品的容器；其中已取出样品的记录保留，位置置空
export const DELETE = handle(async (req: Request, ctx: RouteContext<"/api/v1/freezer/containers/[id]">) => {
  const user = await requireUser();
  const id = Number((await ctx.params).id);
  await withTransaction(async (c) => {
    const old = await ownContainer(c, user, id);
    const r = await c.query("SELECT 1 FROM freezer_samples WHERE container_id = $1 AND status = 'stored' LIMIT 1", [id]);
    if (r.rowCount) throw new HttpError(409, "容器里还有在库样品，请先取出或转移");
    await c.query("DELETE FROM freezer_containers WHERE id = $1", [id]);
    const snapshot = Object.fromEntries(FIELDS.map((k) => [k, old[k] ?? null]));
    await audit(user.id, "freezer_container.delete", "freezer_container", id, { snapshot }, req, c);
  });
  return ok({ ok: true });
});
