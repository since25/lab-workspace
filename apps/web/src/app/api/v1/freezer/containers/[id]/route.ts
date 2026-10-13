import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { checkContainerPlace, ownContainer, parseContainerInput, samePlace } from "@/lib/freezer-server";
import { HttpError, handle, ok, readJson } from "@/lib/http";

const FIELDS = ["freezer_id", "kind", "name", "shelf_no", "rack_no", "slot_no", "tier_no", "depth_no", "is_shared", "remarks"] as const;

// 修改自己的容器（含搬到别的冰箱/层/架/格位）；容器里的样品随之一起移动。管理员可修改公共容器。
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/v1/freezer/containers/[id]">) => {
  const user = await requireUser();
  const id = Number((await ctx.params).id);
  const input = parseContainerInput(await readJson(req), user.role === "admin");
  const warning = await withTransaction(async (c) => {
    const old = await ownContainer(c, user, id);
    // 非管理员修改时保留原有的公共标记（只有管理员能改）
    if (user.role !== "admin") input.is_shared = old.is_shared === true;
    const changes: Record<string, [unknown, unknown]> = {};
    for (const k of FIELDS) {
      if (String(old[k] ?? "") !== String(input[k] ?? "")) changes[k] = [old[k] ?? null, input[k]];
    }
    if (!Object.keys(changes).length) return "";
    const w = await checkContainerPlace(c, user, input, id, !samePlace(old, input));
    await c.query(
      `UPDATE freezer_containers SET freezer_id = $2, kind = $3, name = $4, shelf_no = $5, rack_no = $6, slot_no = $7,
         tier_no = $8, depth_no = $9, is_shared = $10, remarks = $11, updated_at = now() WHERE id = $1`,
      [id, input.freezer_id, input.kind, input.name, input.shelf_no, input.rack_no, input.slot_no, input.tier_no, input.depth_no,
        input.is_shared, input.remarks]
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
    if (r.rowCount) throw new HttpError(409, "里面还有在库样品（含其他人放在公共框里的），请先取出或转移");
    await c.query("DELETE FROM freezer_containers WHERE id = $1", [id]);
    const snapshot = Object.fromEntries(FIELDS.map((k) => [k, old[k] ?? null]));
    await audit(user.id, "freezer_container.delete", "freezer_container", id, { snapshot }, req, c);
  });
  return ok({ ok: true });
});
