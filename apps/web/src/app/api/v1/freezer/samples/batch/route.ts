import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { formatLocation, type ContainerPos } from "@/lib/freezer";
import { CONTAINER_SQL, resolveTargetContainer } from "@/lib/freezer-server";
import { HttpError, handle, ok, readJson, str } from "@/lib/http";

const MAX_BATCH = 500;

// 批量取出 / 转移：{ids, action: "remove" | "move", note?, container_id? | new_container?}
// - remove：在库样品标为已取出，记录保留
// - move：转移到已有容器，或在同一事务里新建容器后转移；已取出的样品转入容器即视为放回
// 每管样品各写一条审计日志，记录原位置、新位置和用途说明
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await readJson(req);
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw new HttpError(400, "请先勾选样品");
  if (ids.length > MAX_BATCH) throw new HttpError(400, `一次最多处理 ${MAX_BATCH} 管`);
  const action = str(body.action);
  if (action !== "remove" && action !== "move") throw new HttpError(400, "不支持的操作");
  const note = str(body.note);

  const result = await withTransaction(async (c) => {
    const rows = (
      await c.query(
        `SELECT s.id, s.name, s.status, s.container_id FROM freezer_samples s
          WHERE s.id = ANY($1::int[]) AND s.owner_id = $2 ORDER BY s.id FOR UPDATE`,
        [ids, user.id]
      )
    ).rows as { id: number; name: string; status: string; container_id: number | null }[];
    if (rows.length !== ids.length) throw new HttpError(404, "部分样品不存在或不属于你，请刷新后重试");

    // 原位置文字（容器可能已删除）
    const cids = [...new Set(rows.map((r) => r.container_id).filter((x): x is number => x !== null))];
    const locs = new Map<number, string>();
    if (cids.length) {
      for (const ct of (await c.query(`${CONTAINER_SQL} WHERE ct.id = ANY($1::int[])`, [cids])).rows) {
        locs.set(ct.id, formatLocation(ct as ContainerPos));
      }
    }
    const fromOf = (r: (typeof rows)[number]) => (r.status === "removed" ? "（已取出）" : locs.get(r.container_id!) ?? "");

    if (action === "remove") {
      const targets = rows.filter((r) => r.status === "stored");
      await c.query(
        "UPDATE freezer_samples SET status = 'removed', removed_at = now(), updated_at = now() WHERE id = ANY($1::int[])",
        [targets.map((r) => r.id)]
      );
      for (const r of targets) {
        await audit(user.id, "freezer_sample.remove", "freezer_sample", r.id, { name: r.name, from: fromOf(r), note }, req, c);
      }
      return { done: targets.length, skipped: rows.length - targets.length, warning: "" };
    }

    const { container: target, warning } = await resolveTargetContainer(c, user, body, req);
    const containerId = target.id;
    const to = formatLocation(target as unknown as ContainerPos);
    const targets = rows.filter((r) => !(r.status === "stored" && r.container_id === containerId));
    await c.query(
      `UPDATE freezer_samples SET container_id = $2, status = 'stored', removed_at = NULL, updated_at = now()
        WHERE id = ANY($1::int[])`,
      [targets.map((r) => r.id), containerId]
    );
    for (const r of targets) {
      await audit(user.id, "freezer_sample.move", "freezer_sample", r.id, { name: r.name, from: fromOf(r), to, note }, req, c);
    }
    return { done: targets.length, skipped: rows.length - targets.length, container_id: containerId, warning };
  });
  return ok(result);
});
