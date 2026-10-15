import type { PoolClient } from "pg";
import { audit } from "./audit";
import type { MaterialRow } from "./imports/materials";

export class MaterialError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// 仅这些 OA 字段参与增量写入，本地申请、已用完和操作人字段不在此列表。
const COLUMNS = {
  requested_on: "date", requester: "text", department: "text", request_no: "text", material_code: "text",
  status: "text", major_category: "text", minor_category: "text", item_name: "text", brand: "text",
  spec_model: "text", unit: "text", quantity: "numeric", is_urgent: "boolean", project_code: "text",
  remarks: "text", order_no: "text", purchased_qty: "numeric", last_received_on: "date",
  received_qty: "numeric", receipt_status: "text",
} satisfies Record<keyof MaterialRow, string>;
const FIELDS = Object.keys(COLUMNS) as (keyof MaterialRow)[];
const MUTABLE = FIELDS.filter(k => k !== "request_no" && k !== "material_code");
const SOURCE = `jsonb_to_recordset($1::jsonb) AS src(${Object.entries(COLUMNS).map(([k, t]) => `${k} ${t}`).join(",")})`;

export function validateMaterialKeys(rows: MaterialRow[]) {
  if (!rows.length) throw new MaterialError("文件里没有可导入的记录");
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    if (!r.request_no || !r.material_code) throw new MaterialError(`第 ${i + 1} 条采购记录缺少采购单编码或物料编码，无法增量匹配`);
    const key = JSON.stringify([r.request_no, r.material_code]);
    const first = seen.get(key);
    if (first !== undefined) throw new MaterialError(`第 ${first + 1}、${i + 1} 条采购记录的采购单编码与物料编码相同，请核对后再导入`);
    seen.set(key, i);
  });
}

export async function importMaterialRows(c: Pick<PoolClient, "query">, rows: MaterialRow[], filename: string, actorId: number | null, req?: Request) {
  validateMaterialKeys(rows);
  const batch = await c.query<{ id: number }>(
    `INSERT INTO import_batches(dataset_type, filename, row_count, accepted_count, rejected_count, status, created_by)
     VALUES ('materials', $1, $2, $2, 0, 'committed', $3) RETURNING id`, [filename, rows.length, actorId]
  );
  const batchId = batch.rows[0].id;
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += 200) {
    // 白名单投影，调用方即使传入本地状态字段也不会覆盖数据库中的标记。
    const chunk = rows.slice(i, i + 200).map(r => Object.fromEntries(FIELDS.map(k => [k, r[k]])));
    const args = [JSON.stringify(chunk), batchId];
    const added = await c.query(
      `INSERT INTO material_items(${FIELDS.join(",")}, import_batch_id)
       SELECT ${FIELDS.map(k => `src.${k}`).join(",")}, $2 FROM ${SOURCE}
       ON CONFLICT (request_no, material_code) DO NOTHING RETURNING id`, args
    );
    inserted += added.rows.length;
    const changed = await c.query(
      `UPDATE material_items m SET ${MUTABLE.map(k => `${k} = src.${k}`).join(",")}, import_batch_id = $2, updated_at = now()
       FROM ${SOURCE} WHERE m.request_no = src.request_no AND m.material_code = src.material_code
       AND (${MUTABLE.map(k => `m.${k}`).join(",")}) IS DISTINCT FROM (${MUTABLE.map(k => `src.${k}`).join(",")})
       RETURNING m.id`, args
    );
    updated += changed.rows.length;
  }
  const result = { batch_id: batchId, inserted, updated, unchanged: rows.length - inserted - updated };
  await audit(actorId, "material.import_incremental", "import_batch", batchId, { ...result, total: rows.length }, req, c);
  return result;
}

export function displayDepartments(raw = process.env.MATERIAL_DISPLAY_DEPARTMENTS_JSON): string[] {
  if (!raw) return [];
  try {
    const values = JSON.parse(raw);
    if (!Array.isArray(values) || values.some(v => typeof v !== "string" || !v.trim())) throw new Error();
    return [...new Set<string>(values.map((v: string) => v.trim()))];
  } catch { throw new MaterialError("物料展示部门配置无效，请联系管理员", 503); }
}

export function materialScope(departments: string[], usedUp: boolean) {
  return { where: "m.department = ANY($1::text[]) AND m.is_used_up = $2", params: [departments, usedUp] as unknown[] };
}

export function materialFilters(sp: URLSearchParams, departments: string[]) {
  const scope = materialScope(departments, sp.get("used_up") === "1");
  const terms = [scope.where];
  const params = [...scope.params];
  const q = sp.get("q")?.trim();
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    terms.push(`(m.item_name ILIKE ${p} OR m.brand ILIKE ${p} OR m.spec_model ILIKE ${p} OR m.material_code ILIKE ${p} OR m.requester ILIKE ${p} OR m.project_code ILIKE ${p} OR m.request_no ILIKE ${p})`);
  }
  for (const [name, col] of [["brand", "brand"], ["requester", "requester"], ["category", "minor_category"], ["status", "status"], ["receipt", "receipt_status"]]) {
    const value = sp.get(name)?.trim();
    if (value) { params.push(value); terms.push(`m.${col} = $${params.length}`); }
  }
  return { where: terms.join(" AND "), params };
}

export type UsageAction = "mark" | "restore" | "approve" | "reject";
export function parseUsageAction(body: Record<string, unknown>, role: string) {
  const action = body.action;
  if (action !== "mark" && action !== "restore" && action !== "approve" && action !== "reject") throw new MaterialError("不支持的物料操作");
  if (action !== "mark" && role !== "admin") throw new MaterialError("需要管理员权限", 403);
  if (role !== "admin" && body.confirmed !== true) throw new MaterialError("请先确认提交已用完申请");
  return action;
}

export function materialIds(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 500 || value.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new MaterialError("请选择 1 至 500 条有效采购记录");
  }
  return [...new Set<number>(value)];
}

// 调用方开启事务。按 ID 锁定后判断状态，避免重复申请覆盖首次申请人。
export async function changeMaterialUsage(c: Pick<PoolClient, "query">, user: { id: number; role: string }, ids: number[], action: UsageAction, departments: string[], req?: Request) {
  if (action !== "mark" && user.role !== "admin") throw new MaterialError("需要管理员权限", 403);
  const old = (await c.query<{ id: number; is_used_up: boolean; used_up_requested_at: Date | null }>(
    `SELECT id, is_used_up, used_up_requested_at FROM material_items
     WHERE id = ANY($1::int[]) AND department = ANY($2::text[]) ORDER BY id FOR UPDATE`, [ids, departments]
  )).rows;
  if (old.length !== ids.length) throw new MaterialError("部分物料不存在或不在展示部门内，请刷新后重试", 404);
  const pending = (r: typeof old[number]) => !r.is_used_up && r.used_up_requested_at !== null;
  const targets = old.filter(r => action === "restore" ? r.is_used_up : action === "approve" || action === "reject" ? pending(r)
    : !r.is_used_up && (user.role === "admin" || !pending(r)));
  if (!targets.length) return { done: 0, skipped: old.length, pending: user.role !== "admin" };
  let set: string;
  if (action === "restore") {
    set = "is_used_up = false, used_up_at = NULL, used_up_by = NULL, used_up_requested_at = NULL, used_up_requested_by = NULL";
  } else if (action === "reject") {
    set = "used_up_requested_at = NULL, used_up_requested_by = NULL";
  } else if (action === "mark" && user.role !== "admin") {
    set = "used_up_requested_at = now(), used_up_requested_by = $2";
  } else {
    set = "is_used_up = true, used_up_at = now(), used_up_by = $2";
  }
  const targetIds = targets.map(r => r.id);
  // 无 $2 的分支只传 ID，避免 PostgreSQL 对多余参数报错。
  await c.query(`UPDATE material_items SET ${set}, updated_at = now() WHERE id = ANY($1::int[])`, set.includes("$2") ? [targetIds, user.id] : [targetIds]);
  const event = action === "mark" && user.role !== "admin" ? "request_used_up" : action;
  await audit(user.id, `material.${event}`, "material_items", "", { ids: targetIds }, req, c);
  return { done: targets.length, skipped: old.length - targets.length, pending: user.role !== "admin" };
}
