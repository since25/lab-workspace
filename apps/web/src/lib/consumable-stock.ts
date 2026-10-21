import type { PoolClient } from "pg";
import { audit } from "./audit";
import type { MaterialQuery } from "./materials-list";
import { MaterialError } from "./materials-data";
import {
  classifyConsumable, stockAmount, stockCategory, stockGroup, stockGroups, stockNote, stockStale, stockStatus, stockText,
  STOCK_STALE_DAYS, type StockCategory, type StockStatus,
} from "./consumables";
import { canonicalBrand, cleanItemName, cleanSpec, normalizeUnit, stockIdentityKey } from "./stock-normalize";

export interface StockItem {
  id: number;
  category: string;
  item_name: string;
  brand: string;
  spec_model: string;
  unit: string;
  quantity: number;
  note: string;
  last_checked_at: string | null;
  checked_by_name: string | null;
  updated_at: string;
  revision: number;
  status: StockStatus;
  stale: boolean;
  // 以下两项由采购记录按 名称+品牌+规格 归一后自动带出；没有可比的采购历史时为 null。
  monthly_usage: number | null;
  last_purchase: { on: string; quantity: number | null; unit: string } | null;
}

export interface StockHistoryItem {
  id: number;
  before_qty: number;
  after_qty: number;
  note: string;
  checked_at: string;
  checked_by_name: string | null;
}

export interface StockSummary {
  item_count: number;
  out_count: number;
  stale_count: number;
  last_checked_at: string | null;
}

export interface StockCategorySummary extends StockSummary {
  name: string;
}

interface RawStock {
  id: number;
  category: string;
  item_name: string;
  brand: string;
  spec_model: string;
  unit: string;
  quantity: string | number;
  note: string;
  last_checked_at: Date | string | null;
  revision: number;
  updated_at: Date | string;
  checked_by_name: string | null;
}

const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString());

function mapStock(row: RawStock, now = Date.now()): StockItem {
  const quantity = Number(row.quantity);
  const like = { quantity, last_checked_at: row.last_checked_at };
  return {
    id: row.id,
    category: row.category,
    item_name: row.item_name,
    brand: row.brand,
    spec_model: row.spec_model,
    unit: row.unit,
    quantity,
    note: row.note,
    last_checked_at: iso(row.last_checked_at),
    checked_by_name: row.checked_by_name,
    updated_at: iso(row.updated_at) as string,
    revision: row.revision,
    status: stockStatus(like, now),
    stale: stockStale(like, now),
    monthly_usage: null,
    last_purchase: null,
  };
}

function summarize(items: StockItem[]): StockSummary {
  return {
    item_count: items.length,
    out_count: items.filter((i) => i.status === "out").length,
    stale_count: items.filter((i) => i.status === "stale").length,
    last_checked_at: items.map((i) => i.last_checked_at).filter((v): v is string => !!v).sort().at(-1) ?? null,
  };
}

const STATUSES: StockStatus[] = ["out", "stale", "ok"];

interface PurchaseGroup {
  item_name: string;
  brand: string;
  spec_model: string;
  unit: string;
  n: number;
  qty: string | number | null;
  first_on: string;
  last_on: string;
  last_qty: string | number | null;
  last_unit: string;
}

const monthIndex = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;

// 参考消耗/月 = 同品（归一后）采购数量合计 ÷ 首次到最近采购跨越的月数（含首尾月），至少 2 笔采购才给出；
// 库存条目填了单位时只统计同单位的采购行，避免支/盒/箱混加。最近采购取最近一笔的日期、数量和单位。
async function purchaseContext(db: MaterialQuery, items: StockItem[], departments: string[]) {
  if (!departments.length || !items.length) return;
  const groups = await db<PurchaseGroup>(
    `SELECT item_name, brand, spec_model, unit, count(*)::int AS n, sum(coalesce(purchased_qty, quantity)) AS qty,
       min(requested_on)::text AS first_on, max(requested_on)::text AS last_on,
       (array_agg(coalesce(purchased_qty, quantity) ORDER BY requested_on DESC, id DESC))[1] AS last_qty,
       (array_agg(unit ORDER BY requested_on DESC, id DESC))[1] AS last_unit
     FROM material_items
     WHERE department = ANY($1::text[]) AND status <> '停用' AND item_name <> '' AND requested_on IS NOT NULL
     GROUP BY item_name, brand, spec_model, unit`, [departments]
  );
  const byKey = new Map<string, PurchaseGroup[]>();
  for (const g of groups) {
    const key = stockIdentityKey(g);
    byKey.set(key, [...(byKey.get(key) ?? []), g]);
  }
  for (const item of items) {
    const all = byKey.get(stockIdentityKey(item)) ?? [];
    if (!all.length) continue;
    // 日期以文本取出（YYYY-MM-DD），避免驱动按服务器时区换算后差一天。
    const latest = all.reduce((a, b) => (b.last_on > a.last_on ? b : a));
    item.last_purchase = { on: latest.last_on, quantity: latest.last_qty === null ? null : Number(latest.last_qty), unit: latest.last_unit };
    const unit = normalizeUnit(item.unit);
    const same = unit ? all.filter((g) => normalizeUnit(g.unit) === unit) : all;
    const n = same.reduce((sum, g) => sum + g.n, 0);
    if (n < 2) continue;
    const first = same.map((g) => g.first_on).sort()[0];
    const last = same.map((g) => g.last_on).sort().at(-1) as string;
    const total = same.reduce((sum, g) => sum + (g.qty === null ? 0 : Number(g.qty)), 0);
    const months = monthIndex(last) - monthIndex(first) + 1;
    if (total > 0) item.monthly_usage = Math.round((total / months) * 100) / 100;
  }
}

// 类别参数可以是大类（标签卡，按「大类/」前缀过滤）或配置中的完整类别名。
function inCategory(item: StockItem, category: string): boolean {
  return item.category === category || stockGroup(item.category) === category;
}

export function parseStockId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new MaterialError("耗材编号无效");
  return id;
}

export async function listStock(
  db: MaterialQuery, sp: URLSearchParams, categories: StockCategory[], departments: string[] = [], now = Date.now()
) {
  const category = sp.get("category")?.trim() ?? "";
  const groups = stockGroups(categories);
  if (category && !categories.some((c) => c.name === category) && !groups.includes(category)) throw new MaterialError("未知的耗材类别");
  const q = sp.get("q")?.trim() ?? "";
  const status = sp.get("status")?.trim() ?? "";
  if (status && !STATUSES.includes(status as StockStatus)) throw new MaterialError("未知的库存状态");

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
    `SELECT s.id, s.category, s.item_name, s.brand, s.spec_model, s.unit, s.quantity, s.note,
       s.last_checked_at, s.revision, s.updated_at, u.display_name AS checked_by_name
     FROM consumable_stock s LEFT JOIN users u ON u.id = s.last_checked_by
     WHERE ${terms.join(" AND ")} ORDER BY s.category, s.item_name, s.id`, params
  );
  const all = rows.map((row) => mapStock(row, now));
  // 类别选项卡和顶部汇总始终按当前搜索词统计全部类别，切换类别只过滤表格，避免其他类别显示成 0。
  const matching = all.filter((i) => !category || inCategory(i, category));
  const items = matching.filter((i) => !status || i.status === status);
  await purchaseContext(db, items, departments);

  const summaryRows = categories.map((c) => ({ name: c.name, ...summarize(all.filter((i) => i.category === c.name)) }));
  const groupRows = groups.map((name) => ({ name, ...summarize(all.filter((i) => stockGroup(i.category) === name)) }));
  return { groups: groupRows, categories: summaryRows, items, summary: summarize(all), stale_days: STOCK_STALE_DAYS, category };
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
    `SELECT s.id, s.category, s.item_name, s.brand, s.spec_model, s.unit, s.quantity, s.note,
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
  const note = stockNote(input.note);
  const initial = input.quantity === undefined || input.quantity === null || input.quantity === "" ? null : stockAmount(input.quantity);
  let id: number;
  try {
    id = (await c.query<{ id: number }>(
      `INSERT INTO consumable_stock(category, item_name, brand, spec_model, unit, quantity, note,
         last_checked_at, last_checked_by, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id`,
      [category, itemName, brand, spec, unit, initial ?? 0, note, initial === null ? null : new Date(), initial === null ? null : user.id, user.id]
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
  // safety_stock 已停用：旧客户端仍可能带上该字段，忽略即可，数据库列保留不动。
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

// 候选只取「复购品」：近 12 个月有采购且（异名归一合并后）累计至少 2 笔；一次性长尾留在采购台账看。
export const CANDIDATE_MIN_PURCHASES = 2;
export const CANDIDATE_RECENT_MONTHS = 12;

// 从展示部门的采购记录里按关键词匹配候选，只新建缺失条目，不改已有库存。
// 品牌别名、名称同义词和「货号:xx 名称:xx」等写法先归一，同一品的多行合并成一个候选；已有同归一键的条目不再新建。
export async function syncStockCandidates(
  c: Pick<PoolClient, "query">, departments: string[], categories: StockCategory[], user: { id: number }, req?: Request, now = Date.now()
) {
  if (!departments.length) throw new MaterialError("尚未配置物料展示部门，无法生成候选耗材");
  const rows = (await c.query<{
    item_name: string; brand: string; spec_model: string; unit: string; category_text: string; n: number; last_on: string | null;
  }>(
    `SELECT item_name, brand, spec_model, unit,
       string_agg(DISTINCT concat_ws(' ', minor_category, major_category), ' ') AS category_text,
       count(*)::int AS n, max(requested_on)::text AS last_on
     FROM material_items
     WHERE department = ANY($1::text[]) AND status <> '停用' AND item_name <> ''
     GROUP BY item_name, brand, spec_model, unit
     ORDER BY max(requested_on) DESC NULLS LAST, item_name LIMIT 5000`, [departments]
  )).rows;
  const since = new Date(now);
  since.setMonth(since.getMonth() - CANDIDATE_RECENT_MONTHS);
  const sinceDay = since.toISOString().slice(0, 10);
  // 行已按最近采购倒序，同一归一键取第一行（最近的写法）作为入库展示值。
  const merged = new Map<string, { category: string; item_name: string; brand: string; spec_model: string; unit: string; n: number; last_on: string }>();
  for (const r of rows) {
    const category = classifyConsumable(`${r.item_name} ${r.spec_model} ${r.category_text}`, categories);
    if (!category) continue;
    const key = stockIdentityKey(r);
    const lastOn = r.last_on ?? "";
    const hit = merged.get(key);
    if (hit) {
      hit.n += r.n;
      if (lastOn > hit.last_on) hit.last_on = lastOn;
      continue;
    }
    merged.set(key, {
      category, item_name: cleanItemName(r.item_name), brand: canonicalBrand(r.brand), spec_model: cleanSpec(r.spec_model, r.item_name),
      unit: r.unit, n: r.n, last_on: lastOn,
    });
  }
  const existing = new Set((await c.query<{ item_name: string; brand: string; spec_model: string }>(
    "SELECT item_name, brand, spec_model FROM consumable_stock"
  )).rows.map((r) => stockIdentityKey(r)));
  const active = [...merged.entries()].filter(([, r]) => r.n >= CANDIDATE_MIN_PURCHASES && r.last_on >= sinceDay);
  const candidates = active.filter(([key]) => !existing.has(key)).map(([, r]) => r);
  const result = { scanned: rows.length, candidates: active.length, created: 0, skipped: active.length - candidates.length };
  if (candidates.length) {
    result.created = (await c.query<{ id: number }>(
      `INSERT INTO consumable_stock(category, item_name, brand, spec_model, unit, quantity, note, created_by, updated_by)
       SELECT t.category, t.item_name, t.brand, t.spec_model, t.unit, 0, '由采购记录生成，待首次核对', $6, $6
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
         AS t(category, item_name, brand, spec_model, unit)
       ON CONFLICT (category, item_name, brand, spec_model) DO NOTHING
       RETURNING id`,
      [
        candidates.map((r) => r.category), candidates.map((r) => r.item_name), candidates.map((r) => r.brand),
        candidates.map((r) => r.spec_model), candidates.map((r) => r.unit), user.id,
      ]
    )).rows.length;
    result.skipped = active.length - result.created;
  }
  await audit(user.id, "material_stock.sync", "consumable_stock", "", result, req, c);
  return result;
}
