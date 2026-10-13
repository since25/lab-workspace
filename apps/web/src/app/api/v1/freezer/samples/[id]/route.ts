import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { SAMPLE_FIELDS, parseSampleInput } from "@/lib/freezer-server";
import { HttpError, handle, ok, readJson } from "@/lib/http";

// 修改自己样品的信息（位置变化走批量转移接口）
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/v1/freezer/samples/[id]">) => {
  const user = await requireUser();
  const id = Number((await ctx.params).id);
  const input = parseSampleInput(await readJson(req), true);
  const changed = await withTransaction(async (c) => {
    const old = (await c.query("SELECT * FROM freezer_samples WHERE id = $1 AND owner_id = $2 FOR UPDATE", [id, user.id])).rows[0];
    if (!old) throw new HttpError(404, "样品不存在");
    const changes: Record<string, [unknown, unknown]> = {};
    for (const k of SAMPLE_FIELDS) {
      if (k in input && old[k] !== input[k]) changes[k] = [old[k], input[k]];
    }
    if (!Object.keys(changes).length) return false;
    const keys = Object.keys(changes);
    await c.query(
      `UPDATE freezer_samples SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
      [id, ...keys.map((k) => input[k as keyof typeof input])]
    );
    await audit(user.id, "freezer_sample.update", "freezer_sample", id, { changes }, req, c);
    return true;
  });
  return ok({ changed });
});

// 删除录错的样品（正常取用请用「取出」，保留记录）；快照写入审计日志
export const DELETE = handle(async (req: Request, ctx: RouteContext<"/api/v1/freezer/samples/[id]">) => {
  const user = await requireUser();
  const id = Number((await ctx.params).id);
  await withTransaction(async (c) => {
    const old = (await c.query("DELETE FROM freezer_samples WHERE id = $1 AND owner_id = $2 RETURNING *", [id, user.id])).rows[0];
    if (!old) throw new HttpError(404, "样品不存在");
    const snapshot = Object.fromEntries([...SAMPLE_FIELDS, "container_id", "status"].map((k) => [k, old[k] ?? null]));
    await audit(user.id, "freezer_sample.delete", "freezer_sample", id, { snapshot }, req, c);
  });
  return ok({ ok: true });
});
