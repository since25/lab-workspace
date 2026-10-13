import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { CELL_FIELDS, parseCellInput } from "@/lib/cells";
import { query, withTransaction } from "@/lib/db";
import { HttpError, handle, ok, readJson } from "@/lib/http";

type CellRecord = Record<string, unknown>;
const SELECT = "SELECT *, to_char(frozen_on, 'YYYY-MM-DD') AS frozen_on FROM cell_inventory WHERE id = $1";

// 修改记录（含取用改管数）：只写有变化的字段，旧值/新值写入审计日志作为修改历史
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/v1/cells/[id]">) => {
  const user = await requireUser();
  const id = Number((await ctx.params).id);
  const input = parseCellInput(await readJson(req), true);
  const result = await withTransaction(async (c) => {
    const old = (await c.query<CellRecord>(SELECT + " FOR UPDATE", [id])).rows[0];
    if (!old) throw new HttpError(404, "记录不存在");
    const changes: Record<string, [unknown, unknown]> = {};
    for (const k of CELL_FIELDS) {
      if (!(k in input)) continue;
      const before = old[k] ?? null;
      const after = input[k] ?? null;
      if (String(before ?? "") !== String(after ?? "")) changes[k] = [before, after];
    }
    if (!Object.keys(changes).length) return { changed: false };
    const sets: string[] = [];
    const vals: unknown[] = [id];
    for (const k of Object.keys(changes)) {
      vals.push(input[k as keyof typeof input]);
      sets.push(`${k} = $${vals.length}`);
    }
    // 结构化值被人工改过后，原文字段同步为新值；改完管数/日期视为已核对该项
    if ("tube_count" in changes) {
      vals.push(input.tube_count == null ? "" : String(input.tube_count));
      sets.push(`tube_count_raw = $${vals.length}`);
    }
    if ("frozen_on" in changes) {
      vals.push(input.frozen_on == null ? "" : String(input.frozen_on));
      sets.push(`frozen_on_raw = $${vals.length}`);
    }
    if ("needs_review" in changes && !input.needs_review) sets.push("review_reason = ''");
    await c.query(`UPDATE cell_inventory SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, vals);
    await audit(user.id, "cell.update", "cell", id, { changes }, req, c);
    return { changed: true };
  });
  const [cell] = await query(SELECT, [id]);
  return ok({ cell, ...result });
});

export const DELETE = handle(async (req: Request, ctx: RouteContext<"/api/v1/cells/[id]">) => {
  const user = await requireUser("admin");
  const id = Number((await ctx.params).id);
  await withTransaction(async (c) => {
    const old = (await c.query<CellRecord>(SELECT, [id])).rows[0];
    if (!old) throw new HttpError(404, "记录不存在");
    await c.query("DELETE FROM cell_inventory WHERE id = $1", [id]);
    // 删除前快照写入审计日志
    const snapshot = Object.fromEntries(CELL_FIELDS.map((k) => [k, old[k] ?? null]));
    await audit(user.id, "cell.delete", "cell", id, { snapshot }, req, c);
  });
  return ok({ ok: true });
});
