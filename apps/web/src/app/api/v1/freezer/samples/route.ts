import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { formatLocation, type ContainerPos } from "@/lib/freezer";
import { ownerFilter, parseSampleInput, resolveTargetContainer } from "@/lib/freezer-server";
import { HttpError, handle, ok, readJson, str } from "@/lib/http";

const MAX_BATCH = 500;

// 样品列表：普通用户只看自己的，管理员 scope=all 只读查看全部（可按 owner 筛选）
// status：stored（默认，在库）/ removed（已取出）/ all
export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const sp = new URL(req.url).searchParams;
  const owner = ownerFilter(user, sp);
  const base: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    base.push(sql.replaceAll("?", `$${params.length}`));
  };
  if (owner !== null) add("s.owner_id = ?", owner);
  const status = str(sp.get("status")) || "stored";
  if (status !== "all") add("s.status = ?", status === "removed" ? "removed" : "stored");
  if (str(sp.get("container"))) add("s.container_id = ?", Number(sp.get("container")) || 0);
  const q = str(sp.get("q"));
  if (q) {
    add(
      "(s.name ILIKE ? OR s.project_no ILIKE ? OR s.sample_type ILIKE ? OR s.remarks ILIKE ? OR ct.name ILIKE ?)",
      `%${q}%`
    );
  }
  // 各温度的数量（用于标签页），不受温度筛选影响
  const from = `FROM freezer_samples s
    LEFT JOIN freezer_containers ct ON ct.id = s.container_id
    LEFT JOIN freezers f ON f.id = ct.freezer_id
    JOIN users u ON u.id = s.owner_id`;
  const baseWhere = base.length ? "WHERE " + base.join(" AND ") : "";
  const countRows = await query<{ temperature: string | null; n: number }>(
    `SELECT f.temperature, count(*)::int AS n ${from} ${baseWhere} GROUP BY f.temperature`,
    params
  );
  const temp = str(sp.get("temp"));
  if (temp) add("f.temperature = ?", temp);
  const samples = await query(
    `SELECT s.id, s.owner_id, s.container_id, s.name, s.project_no, s.sample_type, s.remarks, s.status,
            to_char(s.stored_on, 'YYYY-MM-DD') AS stored_on, s.removed_at,
            ct.kind, ct.name AS container_name, ct.shelf_no, ct.rack_no, ct.slot_no,
            f.name AS freezer_name, f.temperature, u.display_name AS owner_name
       ${from} ${base.length ? "WHERE " + base.join(" AND ") : ""}
      ORDER BY f.temperature::int NULLS LAST, f.name, ct.shelf_no, ct.rack_no NULLS LAST, ct.slot_no NULLS LAST, ct.name, s.id
      LIMIT 2000`,
    params
  );
  const counts: Record<string, number> = { all: 0 };
  for (const r of countRows) {
    counts.all += r.n;
    if (r.temperature) counts[r.temperature] = r.n;
  }
  return ok({ samples, counts });
});

// 批量存入：{container_id | new_container, stored_on?, samples:[{name, project_no, sample_type, remarks}]}
// 全部存到同一个容器；new_container 时在同一事务里先建容器
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await readJson(req);
  const list = Array.isArray(body.samples) ? (body.samples as Record<string, unknown>[]) : [];
  if (!list.length) throw new HttpError(400, "没有要存入的样品");
  if (list.length > MAX_BATCH) throw new HttpError(400, `一次最多存入 ${MAX_BATCH} 管`);
  const samples = list.map((s) => parseSampleInput(s ?? {}, false));
  const storedOn = str(body.stored_on);
  if (storedOn && !/^\d{4}-\d{2}-\d{2}$/.test(storedOn)) throw new HttpError(400, "存入日期格式不正确");
  const result = await withTransaction(async (c) => {
    const { container: ct, warning } = await resolveTargetContainer(c, user, body, req);
    const to = formatLocation(ct as unknown as ContainerPos);
    const out: number[] = [];
    for (const s of samples) {
      const r = await c.query<{ id: number }>(
        `INSERT INTO freezer_samples(owner_id, container_id, name, project_no, sample_type, remarks, stored_on)
         VALUES ($1,$2,$3,$4,$5,$6,coalesce($7::date, current_date)) RETURNING id`,
        [user.id, ct.id, s.name, s.project_no, s.sample_type, s.remarks, storedOn || null]
      );
      out.push(r.rows[0].id);
      await audit(user.id, "freezer_sample.create", "freezer_sample", r.rows[0].id, { name: s.name, to }, req, c);
    }
    return { ids: out, container_id: ct.id, warning };
  });
  return ok(result, 201);
});
