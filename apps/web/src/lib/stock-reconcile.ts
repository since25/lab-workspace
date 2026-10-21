import type { PoolClient } from "pg";
import { audit } from "./audit";
import { listStock, type StockItem } from "./consumable-stock";
import { stockAmount, stockNote, type StockCategory } from "./consumables";
import { MaterialError, materialIds } from "./materials-data";
import type { MaterialQuery } from "./materials-list";

const PAGE = 50;
const STATUS_TEXT: Record<StockItem["status"], string> = {
  out: "需采购", stale: "需复核", ok: "正常",
};

export interface ReconcileMaterial {
  id: number;
  item_name: string;
  brand: string;
  spec_model: string;
  material_code: string;
  request_no: string;
  department: string;
  requested_on: string | null;
  last_received_on: string | null;
  receipt_status: string;
  purchased_qty: number | null;
  received_qty: number | null;
  is_used_up: boolean;
  used_up_requested_at: string | null;
}

export interface ReconcileRequest {
  id: number;
  stock_id: number | null;
  stock_label: string;
  stock_before: number | null;
  stock_revision: number | null;
  proposed_quantity: number | null;
  material_ids: number[];
  note: string;
  status: "pending" | "approved" | "rejected";
  requested_by: number | null;
  requested_by_name: string | null;
  requested_at: string;
  reviewed_by: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string;
  current_quantity: number | null;
  current_revision: number | null;
  stock_changed: boolean;
  materials: ReconcileMaterial[];
}

interface RawReconcile {
  id: number;
  stock_id: number | null;
  stock_label: string;
  stock_before: string | number | null;
  stock_revision: number | null;
  proposed_quantity: string | number | null;
  material_ids: number[] | null;
  note: string;
  status: "pending" | "approved" | "rejected";
  requested_by: number | null;
  requested_at: Date | string;
  reviewed_by: number | null;
  reviewed_at: Date | string | null;
  review_note: string;
  requested_by_name: string | null;
  reviewed_by_name: string | null;
  current_quantity: string | number | null;
  current_revision: number | null;
}

const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString());
const fromClient = (c: Pick<PoolClient, "query">): MaterialQuery =>
  async <T,>(text: string, params?: unknown[]) => (await c.query(text, params)).rows as T[];
const num = (value: string | number | null): number | null => (value === null ? null : Number(value));

function parseId(value: unknown, label: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new MaterialError(`${label}编号无效`);
  return id;
}

function requestIds(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 100 || value.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new MaterialError("请选择 1 至 100 条有效的库存校对请求");
  }
  return [...new Set<number>(value)];
}

function received(row: ReconcileMaterial): boolean {
  if (row.receipt_status.includes("全部收货") || row.receipt_status.includes("已收货")) return true;
  return row.purchased_qty !== null && row.received_qty !== null && row.purchased_qty > 0 && row.received_qty >= row.purchased_qty;
}

function unreceived(row: ReconcileMaterial): boolean {
  if (row.receipt_status.includes("未收货")) return true;
  return row.last_received_on === null && (row.received_qty ?? 0) <= 0;
}

function partial(row: ReconcileMaterial): boolean {
  if (received(row)) return false;
  if (row.receipt_status.includes("部分")) return true;
  return (row.received_qty ?? 0) > 0;
}

function stockLabel(stock: { category: string; item_name: string; brand: string; spec_model: string }): string {
  return [stock.category, stock.item_name, stock.brand, stock.spec_model].filter(Boolean).join(" · ");
}

function mapRequest(row: RawReconcile, materials: ReconcileMaterial[]): ReconcileRequest {
  const stockChanged = row.stock_id !== null && row.proposed_quantity !== null
    && (row.current_revision === null || row.current_revision !== row.stock_revision);
  return {
    id: row.id,
    stock_id: row.stock_id,
    stock_label: row.stock_label,
    stock_before: num(row.stock_before),
    stock_revision: row.stock_revision,
    proposed_quantity: num(row.proposed_quantity),
    material_ids: row.material_ids ?? [],
    note: row.note,
    status: row.status,
    requested_by: row.requested_by,
    requested_by_name: row.requested_by_name,
    requested_at: iso(row.requested_at) as string,
    reviewed_by: row.reviewed_by,
    reviewed_by_name: row.reviewed_by_name,
    reviewed_at: iso(row.reviewed_at),
    review_note: row.review_note,
    current_quantity: num(row.current_quantity),
    current_revision: row.current_revision,
    stock_changed: stockChanged,
    materials,
  };
}

async function materialsByIds(db: MaterialQuery, ids: number[]): Promise<Map<number, ReconcileMaterial>> {
  if (!ids.length) return new Map();
  const rows = await db<{
    id: number; item_name: string; brand: string; spec_model: string; material_code: string; request_no: string;
    department: string; requested_on: string | null; last_received_on: string | null; receipt_status: string;
    purchased_qty: string | number | null; received_qty: string | number | null; is_used_up: boolean; used_up_requested_at: Date | string | null;
  }>(
    `SELECT id, item_name, brand, spec_model, material_code, request_no, department,
       to_char(requested_on,'YYYY-MM-DD') AS requested_on, to_char(last_received_on,'YYYY-MM-DD') AS last_received_on,
       receipt_status, purchased_qty, received_qty, is_used_up, used_up_requested_at
     FROM material_items WHERE id = ANY($1::int[])`, [ids]
  );
  return new Map(rows.map((r) => [r.id, {
    ...r,
    purchased_qty: num(r.purchased_qty),
    received_qty: num(r.received_qty),
    used_up_requested_at: iso(r.used_up_requested_at),
  }]));
}

async function fetchRequest(db: MaterialQuery, id: number, user: { id: number; role: string }): Promise<ReconcileRequest> {
  const row = (await db<RawReconcile>(
    `SELECT r.*, req.display_name AS requested_by_name, rev.display_name AS reviewed_by_name,
       cs.quantity AS current_quantity, cs.revision AS current_revision
     FROM stock_reconcile_requests r
     LEFT JOIN users req ON req.id = r.requested_by
     LEFT JOIN users rev ON rev.id = r.reviewed_by
     LEFT JOIN consumable_stock cs ON cs.id = r.stock_id
     WHERE r.id = $1`, [id]
  ))[0];
  if (!row || (user.role !== "admin" && row.requested_by !== user.id)) throw new MaterialError("库存校对请求不存在", 404);
  const materials = await materialsByIds(db, row.material_ids ?? []);
  return mapRequest(row, (row.material_ids ?? []).map((mid) => materials.get(mid)).filter((m): m is ReconcileMaterial => !!m));
}

// agent 只读上下文：一次返回匹配的库存条目、历史采购记录和近 N 月未收货标记。
export async function searchReconcileContext(
  db: MaterialQuery, sp: URLSearchParams, categories: StockCategory[], departments: string[], now = Date.now()
) {
  const query = sp.get("q")?.trim() ?? "";
  if (!query || query.length > 100) throw new MaterialError("请填写 1 至 100 个字符的耗材名称");
  const months = Math.min(24, Math.max(1, Math.floor(Number(sp.get("months"))) || 2));
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const pattern = `%${query}%`;
  const compact = `%${query.replace(/\s+/g, "")}%`;

  const stock = await listStock(db, new URLSearchParams({ q: query }), categories, now);
  const stockItems = stock.items.slice(0, 20).map((item) => ({ ...item, status_text: STATUS_TEXT[item.status] }));

  const rows = await db<{
    id: number; item_name: string; brand: string; spec_model: string; material_code: string; request_no: string;
    department: string; requested_on: string | null; last_received_on: string | null; receipt_status: string;
    purchased_qty: string | number | null; received_qty: string | number | null; is_used_up: boolean; used_up_requested_at: Date | string | null;
  }>(
    `SELECT id, item_name, brand, spec_model, material_code, request_no, department,
       to_char(requested_on,'YYYY-MM-DD') AS requested_on, to_char(last_received_on,'YYYY-MM-DD') AS last_received_on,
       receipt_status, purchased_qty, received_qty, is_used_up, used_up_requested_at
     FROM material_items
     WHERE department = ANY($1::text[])
       AND (item_name ILIKE $2 OR brand ILIKE $2 OR spec_model ILIKE $2 OR material_code ILIKE $2 OR remarks ILIKE $2
         OR regexp_replace(item_name,'\\s+','','g') ILIKE $3
         OR regexp_replace(brand,'\\s+','','g') ILIKE $3
         OR regexp_replace(spec_model,'\\s+','','g') ILIKE $3
         OR regexp_replace(material_code,'\\s+','','g') ILIKE $3)
     ORDER BY requested_on DESC NULLS LAST, id DESC LIMIT 500`,
    [departments, pattern, compact]
  );
  const purchases = rows.map((r) => {
    const row: ReconcileMaterial = {
      ...r,
      purchased_qty: num(r.purchased_qty),
      received_qty: num(r.received_qty),
      used_up_requested_at: iso(r.used_up_requested_at),
    };
    return {
      ...row,
      recent: row.requested_on !== null && row.requested_on >= cutoffDate,
      received: received(row),
      unreceived: unreceived(row),
      partial: partial(row),
    };
  });
  const active = purchases.filter((p) => !p.is_used_up);
  const pending = active.filter((p) => !!p.used_up_requested_at);
  return {
    query,
    months,
    cutoff: cutoffDate,
    departments,
    stock_items: stockItems,
    purchase_records: purchases,
    summary: {
      stock_match_count: stock.summary.item_count,
      stock_item_count: stockItems.length,
      purchase_count: purchases.length,
      active_purchase_count: active.length,
      recent_purchase_count: purchases.filter((p) => p.recent).length,
      recent_unreceived_count: purchases.filter((p) => p.recent && p.unreceived).length,
      pending_used_up_count: pending.length,
      used_up_count: purchases.filter((p) => p.is_used_up).length,
      purchase_limit: 500,
      truncated: purchases.length >= 500,
      all_material_ids: purchases.map((p) => p.id),
      suggested_material_ids: active.filter((p) => !p.used_up_requested_at).map((p) => p.id),
      pending_material_ids: pending.map((p) => p.id),
    },
  };
}

export async function createReconcileRequest(
  c: Pick<PoolClient, "query">, input: Record<string, unknown>, user: { id: number; role: string },
  departments: string[], req?: Request
) {
  if (input.confirmed !== true) throw new MaterialError("请先确认库存校对内容");
  const note = stockNote(input.note);
  if (!note) throw new MaterialError("请填写校对说明");
  const stockId = input.stock_id === undefined || input.stock_id === null || input.stock_id === "" ? null : parseId(input.stock_id, "耗材");
  let ids: number[] = [];
  if (input.material_ids !== undefined && input.material_ids !== null) {
    if (!Array.isArray(input.material_ids)) throw new MaterialError("采购记录列表格式不正确");
    if (input.material_ids.length) ids = materialIds(input.material_ids);
  }
  const proposed = input.proposed_quantity === undefined || input.proposed_quantity === null || input.proposed_quantity === ""
    ? null : stockAmount(input.proposed_quantity, "建议库存");
  if (!stockId && !ids.length) throw new MaterialError("请至少指定一个耗材条目或采购记录");
  if (proposed !== null && !stockId) throw new MaterialError("建议库存必须关联一个耗材条目");

  let label = "";
  let before: number | null = null;
  let revision: number | null = null;
  if (stockId) {
    const stock = (await c.query<{ category: string; item_name: string; brand: string; spec_model: string; quantity: string | number; revision: number }>(
      "SELECT category, item_name, brand, spec_model, quantity, revision FROM consumable_stock WHERE id = $1", [stockId]
    )).rows[0];
    if (!stock) throw new MaterialError("耗材条目不存在，请刷新后重试", 404);
    label = stockLabel(stock);
    before = Number(stock.quantity);
    revision = stock.revision;
  }
  if (ids.length) {
    const found = (await c.query<{ id: number }>(
      "SELECT id FROM material_items WHERE id = ANY($1::int[]) AND department = ANY($2::text[])", [ids, departments]
    )).rows;
    if (found.length !== ids.length) throw new MaterialError("部分采购记录不存在或不在展示部门内，请刷新后重试", 404);
  }
  let id: number;
  try {
    id = (await c.query<{ id: number }>(
      `INSERT INTO stock_reconcile_requests(stock_id, stock_label, stock_before, stock_revision, proposed_quantity,
         material_ids, note, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [stockId, label, before, revision, proposed, ids, note, user.id]
    )).rows[0].id;
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "23505") {
      throw new MaterialError("该耗材已有待审批的库存校对请求，请等待管理员处理", 409);
    }
    throw e;
  }
  await audit(user.id, "material.reconcile_submit", "stock_reconcile_request", id, {
    stock_id: stockId, proposed_quantity: proposed, material_count: ids.length,
  }, req, c);
  return fetchRequest(fromClient(c), id, user);
}

export async function listReconcileRequests(db: MaterialQuery, sp: URLSearchParams, user: { id: number; role: string }) {
  const status = sp.get("status")?.trim() || "all";
  if (!["all", "pending", "approved", "rejected"].includes(status)) throw new MaterialError("未知的请求状态");
  const scope = user.role === "admin" ? "" : "AND r.requested_by = $2";
  const params: unknown[] = user.role === "admin" ? [status] : [status, user.id];
  const [{ count }] = await db<{ count: string }>(
    `SELECT count(*) FROM stock_reconcile_requests r
     WHERE ($1 = 'all' OR r.status = $1) ${scope}`, params
  );
  const total = Number(count);
  const requested = Math.max(1, Math.floor(Number(sp.get("page"))) || 1);
  const page = Math.min(requested, Math.max(1, Math.ceil(total / PAGE)));
  const rows = await db<RawReconcile>(
    `SELECT r.*, req.display_name AS requested_by_name, rev.display_name AS reviewed_by_name,
       cs.quantity AS current_quantity, cs.revision AS current_revision
     FROM stock_reconcile_requests r
     LEFT JOIN users req ON req.id = r.requested_by
     LEFT JOIN users rev ON rev.id = r.reviewed_by
     LEFT JOIN consumable_stock cs ON cs.id = r.stock_id
     WHERE ($1 = 'all' OR r.status = $1) ${scope}
     ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.requested_at DESC, r.id DESC
     LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, params
  );
  const materialMap = await materialsByIds(db, [...new Set(rows.flatMap((r) => r.material_ids ?? []))]);
  return {
    items: rows.map((r) => mapRequest(r, (r.material_ids ?? []).map((id) => materialMap.get(id)).filter((m): m is ReconcileMaterial => !!m))),
    total, page, page_size: PAGE, status,
  };
}

export async function getReconcileRequest(db: MaterialQuery, id: number, user: { id: number; role: string }) {
  return fetchRequest(db, id, user);
}

export async function reviewReconcileRequests(
  c: Pick<PoolClient, "query">, idsInput: unknown, action: unknown, user: { id: number; role: string }, reviewNote: unknown, req?: Request
) {
  if (action !== "approve" && action !== "reject") throw new MaterialError("请选择批准或驳回");
  const ids = requestIds(idsInput);
  const note = stockNote(reviewNote);
  const rows = (await c.query<{
    id: number; stock_id: number | null; proposed_quantity: string | number | null; stock_before: string | number | null;
    stock_revision: number | null; material_ids: number[]; note: string; status: string; stock_label: string;
  }>(
    "SELECT id, stock_id, proposed_quantity, stock_before, stock_revision, material_ids, note, status, stock_label FROM stock_reconcile_requests WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE",
    [ids]
  )).rows;
  if (rows.length !== ids.length) throw new MaterialError("部分库存校对请求不存在，请刷新后重试", 404);
  const pending = rows.filter((r) => r.status === "pending");
  const skipped = rows.length - pending.length;
  if (!pending.length) return { approved: 0, rejected: 0, skipped };

  const stockBefore = new Map<number, number>();
  if (action === "approve") {
    for (const row of pending) {
      if (row.stock_id !== null && row.proposed_quantity !== null) {
        const stock = (await c.query<{ quantity: string | number; revision: number }>(
          "SELECT quantity, revision FROM consumable_stock WHERE id = $1 FOR UPDATE", [row.stock_id]
        )).rows[0];
        if (!stock) throw new MaterialError(`「${row.stock_label}」条目已删除，请驳回后重新提交`, 409);
        if (stock.revision !== row.stock_revision) {
          throw new MaterialError(`「${row.stock_label}」库存已变化，请驳回后让提交人重新核对`, 409);
        }
        stockBefore.set(row.id, Number(stock.quantity));
      }
    }
    const allMaterialIds = [...new Set(pending.flatMap((r) => r.material_ids ?? []))];
    if (allMaterialIds.length) {
      const found = (await c.query<{ id: number }>("SELECT id FROM material_items WHERE id = ANY($1::int[])", [allMaterialIds])).rows;
      if (found.length !== allMaterialIds.length) throw new MaterialError("部分采购记录已不存在，请驳回后重新提交", 409);
    }
  }

  let approved = 0;
  let rejected = 0;
  for (const row of pending) {
    if (action === "reject") {
      await c.query(
        "UPDATE stock_reconcile_requests SET status = 'rejected', reviewed_by = $1, reviewed_at = now(), review_note = $2 WHERE id = $3",
        [user.id, note, row.id]
      );
      await audit(user.id, "material.reconcile_reject", "stock_reconcile_request", row.id, {
        stock_id: row.stock_id, material_count: (row.material_ids ?? []).length,
      }, req, c);
      rejected += 1;
      continue;
    }
    if (row.stock_id !== null && row.proposed_quantity !== null) {
      const before = stockBefore.get(row.id) ?? Number(row.stock_before ?? 0);
      const after = Number(row.proposed_quantity);
      await c.query(
        `UPDATE consumable_stock SET quantity = $1, last_checked_at = now(), last_checked_by = $2,
           updated_by = $2, updated_at = now(), revision = revision + 1 WHERE id = $3`,
        [after, user.id, row.stock_id]
      );
      await c.query(
        "INSERT INTO consumable_stock_checks(stock_id, before_qty, after_qty, note, checked_by) VALUES ($1,$2,$3,$4,$5)",
        [row.stock_id, before, after, `${row.note}（库存校对请求 #${row.id}）`, user.id]
      );
      await audit(user.id, "material_stock.reconcile_approve", "consumable_stock", row.stock_id, {
        request_id: row.id, before, after,
      }, req, c);
    }
    if ((row.material_ids ?? []).length) {
      await c.query(
        `UPDATE material_items SET is_used_up = true, used_up_at = now(), used_up_by = $1,
           used_up_requested_at = NULL, used_up_requested_by = NULL, updated_at = now()
         WHERE id = ANY($2::int[])`, [user.id, row.material_ids]
      );
      await audit(user.id, "material.reconcile_approve", "material_items", "", {
        request_id: row.id, ids: row.material_ids,
      }, req, c);
    }
    await c.query(
      "UPDATE stock_reconcile_requests SET status = 'approved', reviewed_by = $1, reviewed_at = now(), review_note = $2 WHERE id = $3",
      [user.id, note, row.id]
    );
    approved += 1;
  }
  return { approved, rejected, skipped };
}

export function parseReconcileId(value: unknown): number {
  return parseId(value, "库存校对请求");
}
