import type { PoolClient } from "pg";
import { audit } from "./audit";
import type { MaterialQuery } from "./materials-list";
import { MaterialError } from "./materials-data";
import {
  classifyConsumable, stockAmount, stockCategory, stockNote, stockStale, stockStatus, stockText,
  STOCK_STALE_DAYS, type StockCategory, type StockStatus,
} from "./consumables";

export interface StockItem {
  id: number;
  category: string;
  item_name: string;
  brand: string;
  spec_model: string;
  unit: string;
  quantity: number;
  safety_stock: number;
  note: string;
  last_checked_at: string | null;
  checked_by_name: string | null;
  updated_at: string;
  revision: number;
  status: StockStatus;
  stale: boolean;
}

export interface StockHistoryItem {
  id: number;
  before_qty: number;
  after_qty: number;
  note: string;
  checked_at: string;
  checked_by_name: string | null;
}

export interface StockCategorySummary {
  name: string;
  item_count: number;
  unchecked_count: number;
  out_count: number;
  low_count: number;
  stale_count: number;
  last_checked_at: string | null;
}

export interface StockSummary {
  item_count: number;
  unchecked_count: number;
  out_count: number;
  low_count: number;
  stale_count: number;
  last_checked_at: string | null;
}

interface RawStock {
  id: number;
  category: string;
  item_name: string;
  brand: string;
  spec_model: string;
  unit: string;
  quantity: string | number;
  safety_stock: string | number;
  note: string;
  last_checked_at: Date | string | null;
  revision: number;
  updated_at: Date | string;
  checked_by_name: string | null;
}

const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString());

function mapStock(row: RawStock, now = Date.now()): StockItem {
  const quantity = Number(row.quantity);
  const safetyStock = Number(row.safety_stock);
  const like = { quantity, safety_stock: safetyStock, last_checked_at: row.last_checked_at };
  return {
    id: row.id,
    category: row.category,
    item_name: row.item_name,
    brand: row.brand,
    spec_model: row.spec_model,
    unit: row.unit,
    quantity,
    safety_stock: safetyStock,
    note: row.note,
    last_checked_at: iso(row.last_checked_at),
    checked_by_name: row.checked_by_name,
    updated_at: iso(row.updated_at) as string,
    revision: row.revision,
    status: stockStatus(like),
    stale: stockStale(like, now),
  };
}

function summarize(items: StockItem[]): StockSummary {
  return {
    item_count: items.length,
    unchecked_count: items.filter((i) => i.status === "unchecked").length,
    out_count: items.filter((i) => i.status === "out").length,
    low_count: items.filter((i) => i.status === "low").length,
    // 未核对过的条目已经计入 unchecked，不重复算「待复核」。
    stale_count: items.filter((i) => i.status !== "unchecked" && i.stale).length,
    last_checked_at: items.map((i) => i.last_checked_at).filter((v): v is string => !!v).sort().at(-1) ?? null,
  };
}

const STATUSES: StockStatus[] = ["unchecked", "out", "low", "ok"];

export function parseStockId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new MaterialError("耗材编号无效");
  return id;
}

export async function listStock(db: MaterialQuery, sp: URLSearchParams, categories: StockCategory[], now = Date.now()) {
  const category = sp.get("category")?.trim() ?? "";
  if (category && !categories.some((c) => c.name === category)) throw new MaterialError("未知的耗材类别");
  const q = sp.get("q")?.trim() ?? "";
  const status = sp.get("status")?.trim() ?? "";
  if (status && status !== "stale" && !STATUSES.includes(status as StockStatus)) throw new MaterialError("未知的库存状态");

  const terms = ["1 = 1"];
  const params: unknown[] = [];
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    // 采购/库存名称里常带空格（如「24 孔板」），搜索时同时比较去掉空格后的文本。
    params.push(`%${q.replace(/\s+/g, "")}%`);
    const compact = `$${params.length}`;
    terms.push(`(s.item_name ILIKE ${p} OR s.brand ILIKE ${p} OR s.spec_model ILIKE ${p} OR s.note ILIKE ${p}
      OR regexp_replace(s.item_name,'\\s+','','g') ILIKE ${compact}
      OR regexp_replace(s.brand,'\\s+','','g') ILIKE ${compact}
      OR regexp_replace(s.spec_model,'\\s+','','g') ILIKE ${compact})`);
  }
  const rows = await db<RawStock>(
    `SELECT s.id, s.category, s.item_name, s.brand, s.spec_model, s.unit, s.quantity, s.safety_stock, s.note,
       s.last_checked_at, s.revision, s.updated_at, u.display_name AS checked_by_name
     FROM consumable_stock s LEFT JOIN users u ON u.id = s.last_checked_by
     WHERE ${terms.join(" AND ")} ORDER BY s.category, s.item_name, s.id`, params
  );
  const all = rows.map((row) => mapStock(row, now));
  // 类别选项卡和顶部汇总始终按当前搜索词统计全部类别，切换类别只过滤表格，避免其他类别显示成 0。
  const matching = all.filter((i) => !category || i.category === category);
  const items = matching.filter((i) => !status || (status === "stale" ? i.status !== "unchecked" && i.stale : i.status === status));

  const summaryRows = categories.map((c) => {
    const own = all.filter((i) => i.category === c.name);
    return { name: c.name, ...summarize(own) };
  });
  return { categories: summaryRows, items, summary: summarize(all), stale_days: STOCK_STALE_DAYS, category };
}

export async function listChecks(db: MaterialQuery, id: number, limit = 10): Promise<StockHistoryItem[]> {
  const size = Math.min(50, Math.max(1, Math.floor(Number(limit)) || 10));
  const rows = await db<{ id: number; before_qty: string | number; after_qty: string | number; note: string; checked_at: Date | string; checked_by_name: string | null }>(
    `SELECT c.id, c.before_qty, c.after_qty, c.note, c.checked_at, u.display_name AS checked_by_name
     FROM consumable_stock_checks c LEFT JOIN users u ON u.id = c.checked_by
     WHERE c.stock_id = $1 ORDER BY c.checked_at DESC, c.id DESC LIMIT ${size}`, [id]
  );
  return rows.map((r) => ({
    id: r.id,
    before_qty: Number(r.before_qty),
    after_qty: Number(r.after_qty),
    note: r.note,
    checked_at: iso(r.checked_at) as string,
    checked_by_name: r.checked_by_name,
  }));
}

async function fetchStock(c: Pick<PoolClient, "query">, id: number): Promise<StockItem> {
  const row = (await c.query<RawStock>(
    `SELECT s.id, s.category, s.item_name, s.brand, s.spec_model, s.unit, s.quantity, s.safety_stock, s.note,
       s.last_checked_at, s.revision, s.updated_at, u.display_name AS checked_by_name
     FROM consumable_stock s LEFT JOIN users u ON u.id = s.last_checked_by WHERE s.id = $1`, [id]
  )).rows[0];
  if (!row) throw new MaterialError("耗材不存在，请刷新后重试", 404);
  return mapStock(row);
}

function uniqueConflict(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

export async function createStockItem(
  c: Pick<PoolClient, "query">, input: Record<string, unknown>, user: { id: number }, categories: StockCategory[], req?: Request
) {
  const category = stockCategory(input.category, categories);
  const itemName = stockText(input.item_name, "耗材名称", 200, true);
  const brand = stockText(input.brand, "品牌", 100);
  const spec = stockText(input.spec_model, "规格型号", 200);
  const unit = stockText(input.unit, "单位", 20);
  const safety = input.safety_stock === undefined || input.safety_stock === "" ? 0 : stockAmount(input.safety_stock, "安全库存");
  const note = stockNote(input.note);
  const initial = input.quantity === undefined || input.quantity === null || input.quantity === "" ? null : stockAmount(input.quantity);
  let id: number;
  try {
    id = (await c.query<{ id: number }>(
      `INSERT INTO consumable_stock(category, item_name, brand, spec_model, unit, quantity, safety_stock, note,
         last_checked_at, last_checked_by, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`,
      [category, itemName, brand, spec, unit, initial ?? 0, safety, note, initial === null ? null : new Date(), initial === null ? null : user.id, user.id]
    )).rows[0].id;
  } catch (e) {
    if (uniqueConflict(e)) throw new MaterialError("同名同品牌同规格的耗材已存在，请直接核对", 409);
    throw e;
  }
  if (initial !== null) {
    await c.query(
      "INSERT INTO consumable_stock_checks(stock_id, before_qty, after_qty, note, checked_by) VALUES ($1, 0, $2, $3, $4)",
      [id, initial, "建立库存", user.id]
    );
  }
  await audit(user.id, "material_stock.create", "consumable_stock", id, { category, item_name: itemName, brand, spec_model: spec, initial }, req, c);
  return fetchStock(c, id);
}

export async function updateStockItem(
  c: Pick<PoolClient, "query">, id: number, input: Record<string, unknown>, user: { id: number }, categories: StockCategory[], req?: Request
) {
  const current = (await c.query<{ id: number }>("SELECT id FROM consumable_stock WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!current) throw new MaterialError("耗材不存在，请刷新后重试", 404);
  if (input.quantity !== undefined) throw new MaterialError("库存数量请通过「核对」修改");
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => { params.push(value); sets.push(`${column} = $${params.length}`); };
  if (input.category !== undefined) set("category", stockCategory(input.category, categories));
  if (input.item_name !== undefined) set("item_name", stockText(input.item_name, "耗材名称", 200, true));
  if (input.brand !== undefined) set("brand", stockText(input.brand, "品牌", 100));
  if (input.spec_model !== undefined) set("spec_model", stockText(input.spec_model, "规格型号", 200));
  if (input.unit !== undefined) set("unit", stockText(input.unit, "单位", 20));
  if (input.safety_stock !== undefined) set("safety_stock", stockAmount(input.safety_stock, "安全库存"));
  if (input.note !== undefined) set("note", stockNote(input.note));
  if (!sets.length) throw new MaterialError("没有需要修改的内容");
  params.push(user.id);
  sets.push(`updated_by = $${params.length}`, "updated_at = now()", "revision = revision + 1");
  params.push(id);
  try {
    await c.query(`UPDATE consumable_stock SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  } catch (e) {
    if (uniqueConflict(e)) throw new MaterialError("同名同品牌同规格的耗材已存在", 409);
    throw e;
  }
  await audit(user.id, "material_stock.update", "consumable_stock", id, { fields: Object.keys(input) }, req, c);
  return fetchStock(c, id);
}

export async function checkStock(
  c: Pick<PoolClient, "query">, id: number, input: Record<string, unknown>, user: { id: number }, req?: Request
) {
  const quantity = stockAmount(input.quantity, "核对数量");
  const note = stockNote(input.note);
  const current = (await c.query<{ quantity: string | number; revision: number }>(
    "SELECT quantity, revision FROM consumable_stock WHERE id = $1 FOR UPDATE", [id]
  )).rows[0];
  if (!current) throw new MaterialError("耗材不存在，请刷新后重试", 404);
  if (input.expected_revision !== undefined && input.expected_revision !== null && input.expected_revision !== "") {
    const expected = Number(input.expected_revision);
    if (!Number.isInteger(expected) || expected !== current.revision) {
      throw new MaterialError("库存刚刚被其他人更新，请刷新后重新核对", 409);
    }
  }
  const before = Number(current.quantity);
  await c.query(
    `UPDATE consumable_stock SET quantity = $1, last_checked_at = now(), last_checked_by = $2,
       updated_by = $2, updated_at = now(), revision = revision + 1 WHERE id = $3`, [quantity, user.id, id]
  );
  await c.query(
    "INSERT INTO consumable_stock_checks(stock_id, before_qty, after_qty, note, checked_by) VALUES ($1,$2,$3,$4,$5)",
    [id, before, quantity, note, user.id]
  );
  await audit(user.id, "material_stock.check", "consumable_stock", id, { before, after: quantity, note }, req, c);
  return fetchStock(c, id);
}

export async function deleteStockItem(c: Pick<PoolClient, "query">, id: number, user: { id: number }, req?: Request) {
  const row = (await c.query<{ category: string; item_name: string; brand: string; spec_model: string; quantity: string | number }>(
    "SELECT category, item_name, brand, spec_model, quantity FROM consumable_stock WHERE id = $1 FOR UPDATE", [id]
  )).rows[0];
  if (!row) throw new MaterialError("耗材不存在，请刷新后重试", 404);
  const pending = await c.query("SELECT 1 FROM stock_reconcile_requests WHERE stock_id = $1 AND status = 'pending' LIMIT 1", [id]);
  if (pending.rows.length) throw new MaterialError("该耗材有待审批的库存校对请求，请先批准或驳回", 409);
  await c.query("DELETE FROM consumable_stock WHERE id = $1", [id]);
  await audit(user.id, "material_stock.delete", "consumable_stock", id, {
    category: row.category, item_name: row.item_name, brand: row.brand, spec_model: row.spec_model, quantity: Number(row.quantity),
  }, req, c);
  return { deleted: 1 };
}

// 从展示部门的采购记录里按关键词匹配候选，只新建缺失条目，不改已有库存。
export async function syncStockCandidates(
  c: Pick<PoolClient, "query">, departments: string[], categories: StockCategory[], user: { id: number }, req?: Request
) {
  if (!departments.length) throw new MaterialError("尚未配置物料展示部门，无法生成候选耗材");
  const rows = (await c.query<{ item_name: string; brand: string; spec_model: string; unit: string; category_text: string }>(
    `SELECT item_name, brand, spec_model, unit,
       string_agg(DISTINCT concat_ws(' ', minor_category, major_category), ' ') AS category_text
     FROM material_items
     WHERE department = ANY($1::text[]) AND status <> '停用' AND item_name <> ''
     GROUP BY item_name, brand, spec_model, unit
     ORDER BY max(requested_on) DESC NULLS LAST, item_name LIMIT 5000`, [departments]
  )).rows;
  const candidates = rows
    .map((r) => ({ ...r, category: classifyConsumable(`${r.item_name} ${r.spec_model} ${r.category_text}`, categories) }))
    .filter((r): r is typeof r & { category: string } => !!r.category);
  if (!candidates.length) {
    await audit(user.id, "material_stock.sync", "consumable_stock", "", { scanned: rows.length, created: 0, skipped: 0 }, req, c);
    return { scanned: rows.length, candidates: 0, created: 0, skipped: 0 };
  }
  const created = (await c.query<{ id: number }>(
    `INSERT INTO consumable_stock(category, item_name, brand, spec_model, unit, quantity, safety_stock, note, created_by, updated_by)
     SELECT t.category, t.item_name, t.brand, t.spec_model, t.unit, 0, 0, '由采购记录生成，待首次核对', $6, $6
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
       AS t(category, item_name, brand, spec_model, unit)
     ON CONFLICT (category, item_name, brand, spec_model) DO NOTHING
     RETURNING id`,
    [
      candidates.map((r) => r.category), candidates.map((r) => r.item_name), candidates.map((r) => r.brand),
      candidates.map((r) => r.spec_model), candidates.map((r) => r.unit), user.id,
    ]
  )).rows.length;
  const skipped = candidates.length - created;
  await audit(user.id, "material_stock.sync", "consumable_stock", "", { scanned: rows.length, candidates: candidates.length, created, skipped }, req, c);
  return { scanned: rows.length, candidates: candidates.length, created, skipped };
}
