import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { checkRackOwner, parseRackInput } from "@/lib/freezer-server";
import { HttpError, handle, ok, readJson } from "@/lib/http";

const RACK_SQL = "SELECT * FROM freezer_racks WHERE id = $1 FOR UPDATE";
// 架子所在位置上的盒子/框
const AT_RACK = "FROM freezer_containers WHERE freezer_id = $1 AND shelf_no = $2 AND rack_no = $3";

// 分配 / 改规格 / 备注：{owner_id, tiers, depth, remarks}。改分配不移动已有盒子；缩小规格时不能有盒子落在外面
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/v1/freezer/racks/[id]">) => {
  const user = await requireUser("admin");
  const id = Number((await ctx.params).id);
  const input = parseRackInput(await readJson(req));
  await checkRackOwner(input.owner_id);
  await withTransaction(async (c) => {
    const old = (await c.query(RACK_SQL, [id])).rows[0];
    if (!old) throw new HttpError(404, "架子不存在");
    const out = await c.query(`SELECT 1 ${AT_RACK} AND (tier_no > $4 OR depth_no > $5) LIMIT 1`, [
      old.freezer_id, old.shelf_no, old.position, input.tiers, input.depth,
    ]);
    if (out.rowCount) throw new HttpError(409, "有盒子在缩小后的范围之外，请先把它们移到范围内");
    const changes: Record<string, [unknown, unknown]> = {};
    for (const k of ["owner_id", "tiers", "depth", "remarks"] as const) {
      if (String(old[k] ?? "") !== String(input[k] ?? "")) changes[k] = [old[k] ?? null, input[k]];
    }
    if (!Object.keys(changes).length) return;
    await c.query("UPDATE freezer_racks SET owner_id = $2, tiers = $3, depth = $4, remarks = $5, updated_at = now() WHERE id = $1", [
      id, input.owner_id, input.tiers, input.depth, input.remarks,
    ]);
    await audit(user.id, "freezer_rack.update", "freezer_rack", id, { changes }, req, c);
  });
  return ok({ ok: true });
});

// 移除架子：架子位置上不能还有盒子/框
export const DELETE = handle(async (req: Request, ctx: RouteContext<"/api/v1/freezer/racks/[id]">) => {
  const user = await requireUser("admin");
  const id = Number((await ctx.params).id);
  await withTransaction(async (c) => {
    const old = (await c.query(RACK_SQL, [id])).rows[0];
    if (!old) throw new HttpError(404, "架子不存在");
    const used = await c.query(`SELECT 1 ${AT_RACK} LIMIT 1`, [old.freezer_id, old.shelf_no, old.position]);
    if (used.rowCount) throw new HttpError(409, "架子上还有盒子，不能移除");
    await c.query("DELETE FROM freezer_racks WHERE id = $1", [id]);
    await audit(user.id, "freezer_rack.delete", "freezer_rack", id, {
      snapshot: { freezer_id: old.freezer_id, shelf_no: old.shelf_no, position: old.position, owner_id: old.owner_id },
    }, req, c);
  });
  return ok({ ok: true });
});
