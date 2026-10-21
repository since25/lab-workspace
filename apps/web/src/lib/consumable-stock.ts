import type { PoolClient } from "pg";
import { audit } from "./audit";
import type { MaterialQuery } from "./materials-list";
import { MaterialError } from "./materials-data";
import {
  stockAmount, stockCategory, stockGroup, stockGroups, stockNote, stockStale, stockStatus, stockText,
  STOCK_STALE_DAYS, type StockCategory, type StockStatus,
} from "./consumables";
import { matchSlot, SLOT_TEMPLATES } from "./consumable-slots";
import { cleanItemName, cleanSpec, normalizeUnit, stockIdentityKey } from "./stock-normalize";

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
  // 一行 = 一个固定规格槽位；slot_key 为内置模板标识（手工新增为 null），baseline_at 为第一次人工核对（基线）时间。
  slot_key: string | null;
  baseline_at: string | null;
  // 已确认挂在该槽位下的品牌货号，只用于识别采购入库。
  skus: { item_name: string; brand: string; spec_model: string }[];
  // 消耗/月：有两次以上盘点（跨度 ≥ 28 天）时按盘点差计算（checks），否则按已归入的采购估算（purchases）。
  monthly_usage: number | null;
  usage_basis: "checks" | "purchases" | null;
  last_purchase: { on: string; quantity: number | null; unit: string } | null;
  // 基线之后确认归入、等待管理员确认加数的采购记录条数。
  pending_inbound: number;
}

export interface StockHistoryItem {
  id: number;
  before_qty: number;
  after_qty: number;
  note: string;
  checked_at: string;
  checked_by_name: string | null;
  // check 人工盘点；inbound 按采购记录确认的入库加数。
  kind: "check" | "inbound";
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
  slot_key: string | null;
  baseline_at: Date | string | null;
}

const STOCK_COLUMNS = `s.id, s.category, s.item_name, s.brand, s.spec_model, s.unit, s.quantity, s.note,
  s.last_checked_at, s.revision, s.updated_at, s.slot_key, s.baseline_at, u.display_name AS checked_by_name`;

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
    slot_key: row.slot_key,
    baseline_at: iso(row.baseline_at),
    skus: [],
    monthly_usage: null,
    usage_basis: null,
    last_purchase: null,
    pending_inbound: 0,
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

// 排序：先按模板的类别顺序（细胞耗材 → 塑料耗材 → 通用耗材 → 培养基 → 常用试剂），再按模板内顺序，手工槽位按名称排在同类别后面。
const SLOT_KEYS = SLOT_TEMPLATES.map((t) => t.key);
const SLOT_CATEGORIES = [...new Set(SLOT_TEMPLATES.map((t) => t.category))];
const slotOrder = (alias: string, keys: string, cats: string) =>
  `array_position(${cats}::text[], ${alias}.category) NULLS LAST, ${alias}.category, array_position(${keys}::text[], ${alias}.slot_key) NULLS LAST, ${alias}.item_name, ${alias}.id`;

const monthIndex = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
const DAY = 24 * 60 * 60 * 1000;
const MONTH_DAYS = 30.44;
// 两次盘点相隔不足 28 天时盘点差波动太大，不给实际消耗。
const MIN_USAGE_DAYS = 28;

// 待入库 = 已确认归入、槽位已有基线、且采购（有收货日期用收货日期）晚于基线日的记录；基线日当天及以前的采购视为已计入基线。
const INBOUND_SQL = `l.state = 'confirmed' AND s.baseline_at IS NOT NULL
  AND coalesce(m.last_received_on, m.requested_on) > (s.baseline_at AT TIME ZONE 'Asia/Shanghai')::date`;

// 为槽位带出：挂着的货号、最近采购、待入库条数和消耗/月。
async function slotContext(db: MaterialQuery, items: StockItem[]) {
  if (!items.length) return;
  const ids = items.map((i) => i.id);
  const byId = new Map(items.map((i) => [i.id, i]));
  const skus = await db<{ stock_id: number; item_name: string; brand: string; spec_model: string }>(
    "SELECT stock_id, item_name, brand, spec_model FROM consumable_stock_skus WHERE stock_id = ANY($1::int[]) ORDER BY id", [ids]
  );
  for (const k of skus) byId.get(k.stock_id)?.skus.push({ item_name: k.item_name, brand: k.brand, spec_model: k.spec_model });

  const purchases = await db<{ stock_id: number; on: string; qty: string | number | null; unit: string; inbound: boolean }>(
    `SELECT l.stock_id, m.requested_on::text AS on, coalesce(m.purchased_qty, m.quantity) AS qty, m.unit, (${INBOUND_SQL}) AS inbound
     FROM consumable_stock_links l JOIN material_items m ON m.id = l.material_id JOIN consumable_stock s ON s.id = l.stock_id
     WHERE l.stock_id = ANY($1::int[]) AND l.state IN ('confirmed', 'stocked', 'skipped') AND m.requested_on IS NOT NULL
     ORDER BY m.requested_on, m.id`, [ids]
  );
  const bought = new Map<number, typeof purchases>();
  for (const p of purchases) {
    bought.set(p.stock_id, [...(bought.get(p.stock_id) ?? []), p]);
    if (p.inbound) (byId.get(p.stock_id) as StockItem).pending_inbound += 1;
  }

  const checks = await db<{ stock_id: number; before_qty: string | number; after_qty: string | number; checked_at: Date | string }>(
    `SELECT stock_id, before_qty, after_qty, checked_at FROM consumable_stock_checks
     WHERE stock_id = ANY($1::int[]) AND kind = 'check' ORDER BY checked_at, id`, [ids]
  );
  const counted = new Map<number, typeof checks>();
  for (const c of checks) counted.set(c.stock_id, [...(counted.get(c.stock_id) ?? []), c]);

  for (const item of items) {
    const rows = bought.get(item.id) ?? [];
    const latest = rows.at(-1);
    if (latest) item.last_purchase = { on: latest.on, quantity: latest.qty === null ? null : Number(latest.qty), unit: latest.unit };

    // 实际消耗 = 基线之后每次盘点的减少量之和（入库加数单独记 inbound，不算在盘点里）÷ 基线到最近盘点的月数。
    const baseline = item.baseline_at ? new Date(item.baseline_at).getTime() : null;
    const after = baseline === null ? [] : (counted.get(item.id) ?? []).filter((c) => new Date(c.checked_at).getTime() > baseline);
    if (baseline !== null && after.length) {
      const days = (new Date(after.at(-1)!.checked_at).getTime() - baseline) / DAY;
      if (days >= MIN_USAGE_DAYS) {
        const used = after.reduce((sum, c) => sum + Math.max(0, Number(c.before_qty) - Number(c.after_qty)), 0);
        item.monthly_usage = Math.round((used / (days / MONTH_DAYS)) * 100) / 100;
        item.usage_basis = "checks";
        continue;
      }
    }
    // 估算 = 同单位采购量合计 ÷ 首次到最近采购跨越的月数（含首尾月），至少 2 笔。
    const unit = normalizeUnit(item.unit);
    const same = unit ? rows.filter((r) => normalizeUnit(r.unit) === unit) : rows;
    if (same.length < 2) continue;
    const total = same.reduce((sum, r) => sum + (r.qty === null ? 0 : Number(r.qty)), 0);
    const months = monthIndex(same.at(-1)!.on) - monthIndex(same[0].on) + 1;
    if (total > 0) {
      item.monthly_usage = Math.round((total / months) * 100) / 100;
      item.usage_basis = "purchases";
    }
  }
}

// 核对工作台待办：待确认归属条数、基线后待确认入库条数。
async function reviewCounts(db: MaterialQuery): Promise<{ pending: number; inbound: number }> {
  return (await db<{ pending: number; inbound: number }>(
    `SELECT count(*) FILTER (WHERE l.state = 'pending')::int AS pending, count(*) FILTER (WHERE ${INBOUND_SQL})::int AS inbound
     FROM consumable_stock_links l JOIN material_items m ON m.id = l.material_id LEFT JOIN consumable_stock s ON s.id = l.stock_id`
  ))[0];
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

export async function listStock(db: MaterialQuery, sp: URLSearchParams, categories: StockCategory[], now = Date.now()) {
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
  params.push(SLOT_KEYS, SLOT_CATEGORIES);
  const rows = await db<RawStock>(
    `SELECT ${STOCK_COLUMNS} FROM consumable_stock s LEFT JOIN users u ON u.id = s.last_checked_by
     WHERE ${terms.join(" AND ")} ORDER BY ${slotOrder("s", `$${params.length - 1}`, `$${params.length}`)}`, params
  );
  const all = rows.map((row) => mapStock(row, now));
  // 类别选项卡和顶部汇总始终按当前搜索词统计全部类别，切换类别只过滤表格，避免其他类别显示成 0。
  const matching = all.filter((i) => !category || inCategory(i, category));
  const items = matching.filter((i) => !status || i.status === status);
  await slotContext(db, items);

  const summaryRows = categories.map((c) => ({ name: c.name, ...summarize(all.filter((i) => i.category === c.name)) }));
  const groupRows = groups.map((name) => ({ name, ...summarize(all.filter((i) => stockGroup(i.category) === name)) }));
  return {
    groups: groupRows, categories: summaryRows, items, summary: summarize(all), stale_days: STOCK_STALE_DAYS, category,
    review: await reviewCounts(db),
  };
}

export async function listChecks(db: MaterialQuery, id: number, limit = 10): Promise<StockHistoryItem[]> {
  const size = Math.min(50, Math.max(1, Math.floor(Number(limit)) || 10));
  const rows = await db<{ id: number; before_qty: string | number; after_qty: string | number; note: string; checked_at: Date | string; checked_by_name: string | null; kind: "check" | "inbound" }>(
    `SELECT c.id, c.before_qty, c.after_qty, c.note, c.checked_at, c.kind, u.display_name AS checked_by_name
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
    kind: r.kind,
  }));
}

async function fetchStock(c: Pick<PoolClient, "query">, id: number): Promise<StockItem> {
  const row = (await c.query<RawStock>(
    `SELECT ${STOCK_COLUMNS} FROM consumable_stock s LEFT JOIN users u ON u.id = s.last_checked_by WHERE s.id = $1`, [id]
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
         last_checked_at, last_checked_by, baseline_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$10,$10) RETURNING id`,
      [category, itemName, brand, spec, unit, initial ?? 0, note, initial === null ? null : new Date(), initial === null ? null : user.id, user.id]
    )).rows[0].id;
  } catch (e) {
    if (uniqueConflict(e)) throw new MaterialError("同类别下已有同名同品牌同规格的槽位，请直接核对", 409);
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
    if (uniqueConflict(e)) throw new MaterialError("同类别下已有同名同品牌同规格的槽位", 409);
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
    `UPDATE consumable_stock SET quantity = $1, last_checked_at = now(), last_checked_by = $2, baseline_at = coalesce(baseline_at, now()),
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

// 建立内置槽位模板：只补缺失的模板槽位，已存在的（含管理员改过名称/单位的）不动。
export async function initSlotTemplates(c: Pick<PoolClient, "query">, categories: StockCategory[], user: { id: number }, req?: Request) {
  const allowed = new Set(categories.map((cat) => cat.name));
  const templates = SLOT_TEMPLATES.filter((t) => allowed.has(t.category));
  const created = templates.length ? (await c.query<{ id: number }>(
    `INSERT INTO consumable_stock(slot_key, category, item_name, brand, spec_model, unit, quantity, created_by, updated_by)
     SELECT t.key, t.category, t.name, t.brand, t.spec_model, t.unit, 0, $7, $7
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) AS t(key, category, name, brand, spec_model, unit)
     ON CONFLICT DO NOTHING RETURNING id`,
    [
      templates.map((t) => t.key), templates.map((t) => t.category), templates.map((t) => t.name),
      templates.map((t) => t.brand ?? ""), templates.map((t) => t.spec_model ?? ""), templates.map((t) => t.unit), user.id,
    ]
  )).rows.length : 0;
  const result = { templates: templates.length, created, skipped: templates.length - created };
  await audit(user.id, "material_stock.init_slots", "consumable_stock", "", result, req, c);
  return result;
}

// 把展示部门里还没处理过的采购记录挂到槽位：
// - 货号（名称|品牌|规格归一键）以前确认过 → 直接归到那个槽位（排除过的直接排除），不再问人；
// - 否则按 consumable-slots.ts 的规则给出建议槽位和把握，等管理员在核对工作台确认；
// - 规则也没命中的不建记录（试剂盒、抗体等长尾留在部门物料里查）。
export async function matchPurchases(c: Pick<PoolClient, "query">, departments: string[], user: { id: number }, req?: Request) {
  if (!departments.length) throw new MaterialError("尚未配置物料展示部门，无法匹配采购记录");
  const slots = new Map((await c.query<{ id: number; slot_key: string }>(
    "SELECT id, slot_key FROM consumable_stock WHERE slot_key IS NOT NULL"
  )).rows.map((r) => [r.slot_key, r.id]));
  if (!slots.size) throw new MaterialError("还没有槽位，请先点「建立槽位模板」");
  const memory = new Map((await c.query<{ identity_key: string; stock_id: number | null }>(
    "SELECT identity_key, stock_id FROM consumable_stock_skus"
  )).rows.map((r) => [r.identity_key, r.stock_id]));
  const rows = (await c.query<{ id: number; item_name: string; brand: string; spec_model: string; minor_category: string }>(
    `SELECT m.id, m.item_name, m.brand, m.spec_model, m.minor_category FROM material_items m
     WHERE m.department = ANY($1::text[]) AND m.status <> '停用' AND m.item_name <> ''
       AND NOT EXISTS (SELECT 1 FROM consumable_stock_links l WHERE l.material_id = m.id)
     ORDER BY m.id`, [departments]
  )).rows;
  const links: { material_id: number; stock_id: number | null; identity_key: string; state: string; confidence: string }[] = [];
  for (const r of rows) {
    const key = stockIdentityKey(r);
    if (memory.has(key)) {
      const stockId = memory.get(key) ?? null;
      links.push({ material_id: r.id, stock_id: stockId, identity_key: key, state: stockId === null ? "excluded" : "confirmed", confidence: "known" });
      continue;
    }
    const hit = matchSlot(r);
    const stockId = hit ? slots.get(hit.key) : undefined;
    if (hit && stockId) links.push({ material_id: r.id, stock_id: stockId, identity_key: key, state: "pending", confidence: hit.confidence });
  }
  if (links.length) {
    await c.query(
      `INSERT INTO consumable_stock_links(material_id, stock_id, identity_key, state, confidence)
       SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::text[], $5::text[])`,
      [links.map((l) => l.material_id), links.map((l) => l.stock_id), links.map((l) => l.identity_key), links.map((l) => l.state), links.map((l) => l.confidence)]
    );
  }
  const count = (state: string) => links.filter((l) => l.state === state).length;
  const result = { scanned: rows.length, suggested: count("pending"), known: count("confirmed"), excluded: count("excluded"), unmatched: rows.length - links.length };
  await audit(user.id, "material_stock.match", "consumable_stock", "", result, req, c);
  return result;
}

export type LinkView = "pending" | "inbound" | "done";
const LINK_VIEWS: LinkView[] = ["pending", "inbound", "done"];

export interface StockLink {
  material_id: number;
  state: "pending" | "confirmed" | "stocked" | "skipped" | "excluded";
  confidence: "known" | "high" | "mid" | "low";
  stock_id: number | null;
  slot_label: string;
  slot_unit: string;
  item_name: string;
  brand: string;
  spec_model: string;
  unit: string;
  quantity: number | null;
  request_no: string;
  minor_category: string;
  requested_on: string | null;
  last_received_on: string | null;
  receipt_status: string;
  applied_qty: number | null;
  decided_by_name: string | null;
  decided_at: string | null;
}

// 核对工作台：pending 待确认归属；inbound 基线后待确认入库；done 已入库/不加数/已排除（最近 200 条）。
export async function listLinks(db: MaterialQuery, sp: URLSearchParams) {
  const view = (sp.get("view")?.trim() || "pending") as LinkView;
  if (!LINK_VIEWS.includes(view)) throw new MaterialError("未知的核对视图");
  const where = view === "pending" ? "l.state = 'pending'"
    : view === "inbound" ? INBOUND_SQL
    : "l.state IN ('stocked', 'skipped', 'excluded')";
  const order = view === "done" ? "l.decided_at DESC NULLS LAST, l.material_id DESC LIMIT 200"
    : `s.id IS NULL, ${slotOrder("s", "$1", "$2")}, m.requested_on DESC, m.id`;
  const rows = await db<Omit<StockLink, "quantity" | "applied_qty" | "decided_at"> & {
    quantity: string | number | null; applied_qty: string | number | null; decided_at: Date | string | null;
    category: string | null; slot_name: string | null;
  }>(
    `SELECT l.material_id, l.state, l.confidence, l.stock_id, s.category, s.item_name AS slot_name, coalesce(s.unit, '') AS slot_unit,
       m.item_name, m.brand, m.spec_model, m.unit, coalesce(m.purchased_qty, m.quantity) AS quantity, m.request_no, m.minor_category,
       m.requested_on::text AS requested_on, m.last_received_on::text AS last_received_on, m.receipt_status,
       l.applied_qty, u.display_name AS decided_by_name, l.decided_at
     FROM consumable_stock_links l JOIN material_items m ON m.id = l.material_id
     LEFT JOIN consumable_stock s ON s.id = l.stock_id LEFT JOIN users u ON u.id = l.decided_by
     WHERE ${where} ORDER BY ${order}`, view === "done" ? [] : [SLOT_KEYS, SLOT_CATEGORIES]
  );
  const counts = await reviewCounts(db);
  const slots = await db<{ id: number; category: string; item_name: string; unit: string }>(
    `SELECT s.id, s.category, s.item_name, s.unit FROM consumable_stock s ORDER BY ${slotOrder("s", "$1", "$2")}`, [SLOT_KEYS, SLOT_CATEGORIES]
  );
  const items: StockLink[] = rows.map(({ category, slot_name, ...r }) => ({
    ...r,
    slot_label: slot_name === null ? "" : `${category} · ${slot_name}`,
    quantity: r.quantity === null ? null : Number(r.quantity),
    applied_qty: r.applied_qty === null ? null : Number(r.applied_qty),
    decided_at: iso(r.decided_at),
  }));
  return { view, items, counts, slots };
}

// 管理员处理一条采购记录：
// confirm 归到某槽位（可改归），记住该货号，同货号的其他待确认记录一起归入；
// exclude 排除，记住该货号，同货号的其他待确认记录一起排除；
// stock 基线后的采购确认入库，槽位库存 + 数量（默认采购数量，可改），记一条入库历史；
// skip 基线后的采购不加数（如已在盘点中数过）。
export async function decideLink(
  c: Pick<PoolClient, "query">, materialId: number, input: Record<string, unknown>, user: { id: number }, req?: Request
) {
  const action = String(input.action ?? "");
  const link = (await c.query<{
    state: string; stock_id: number | null; identity_key: string; item_name: string; brand: string; spec_model: string;
    request_no: string; qty: string | number | null; inbound: boolean;
  }>(
    `SELECT l.state, l.stock_id, l.identity_key, m.item_name, m.brand, m.spec_model, m.request_no,
       coalesce(m.purchased_qty, m.quantity) AS qty, (${INBOUND_SQL}) AS inbound
     FROM consumable_stock_links l JOIN material_items m ON m.id = l.material_id LEFT JOIN consumable_stock s ON s.id = l.stock_id
     WHERE l.material_id = $1 FOR UPDATE OF l`, [materialId]
  )).rows[0];
  if (!link) throw new MaterialError("采购记录不在核对范围内，请刷新后重试", 404);
  const decided = "decided_by = $2, decided_at = now()";

  if (action === "confirm" || action === "exclude") {
    if (link.state === "stocked") throw new MaterialError("已入库的记录不能改归属");
    let stockId: number | null = null;
    if (action === "confirm") {
      stockId = parseStockId(input.stock_id ?? link.stock_id);
      const exists = (await c.query("SELECT 1 FROM consumable_stock WHERE id = $1", [stockId])).rows.length;
      if (!exists) throw new MaterialError("槽位不存在，请刷新后重试", 404);
    }
    const name = cleanItemName(link.item_name);
    await c.query(
      `INSERT INTO consumable_stock_skus(identity_key, stock_id, item_name, brand, spec_model, created_by) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (identity_key) DO UPDATE SET stock_id = EXCLUDED.stock_id`,
      [link.identity_key, stockId, name, link.brand.trim(), cleanSpec(link.spec_model, link.item_name), user.id]
    );
    const state = action === "confirm" ? "confirmed" : "excluded";
    // 本条：已确认/已排除/不加数的也允许改判；同货号的其他记录只带走仍在待确认的。
    const updated = (await c.query(
      `UPDATE consumable_stock_links SET stock_id = $3, state = $4, ${decided}
       WHERE material_id = $1 OR (identity_key = $5 AND state = 'pending') RETURNING material_id`,
      [materialId, user.id, stockId, state, link.identity_key]
    )).rows.length;
    await audit(user.id, `material_stock.link_${action}`, "material_items", materialId, { stock_id: stockId, identity_key: link.identity_key, updated }, req, c);
    return { updated };
  }

  if (action === "stock" || action === "skip") {
    if (!link.inbound || link.stock_id === null) throw new MaterialError("只有槽位基线之后、已确认归属的采购记录才能入库");
    if (action === "skip") {
      await c.query(`UPDATE consumable_stock_links SET state = 'skipped', ${decided} WHERE material_id = $1`, [materialId, user.id]);
      await audit(user.id, "material_stock.link_skip", "material_items", materialId, { stock_id: link.stock_id }, req, c);
      return { updated: 1 };
    }
    const raw = input.quantity === undefined || input.quantity === null || input.quantity === "" ? link.qty : input.quantity;
    const amount = stockAmount(raw, "入库数量");
    if (amount <= 0) throw new MaterialError("入库数量须大于 0；不加数请选「不加数」");
    const before = Number((await c.query<{ quantity: string | number }>(
      "SELECT quantity FROM consumable_stock WHERE id = $1 FOR UPDATE", [link.stock_id]
    )).rows[0].quantity);
    await c.query(
      "UPDATE consumable_stock SET quantity = quantity + $1, updated_by = $2, updated_at = now(), revision = revision + 1 WHERE id = $3",
      [amount, user.id, link.stock_id]
    );
    const note = stockNote(`入库：${[link.request_no, cleanItemName(link.item_name), link.brand.trim()].filter(Boolean).join(" ")}`.slice(0, 500));
    await c.query(
      "INSERT INTO consumable_stock_checks(stock_id, before_qty, after_qty, note, checked_by, kind) VALUES ($1,$2,$3,$4,$5,'inbound')",
      [link.stock_id, before, before + amount, note, user.id]
    );
    await c.query(`UPDATE consumable_stock_links SET state = 'stocked', applied_qty = $3, ${decided} WHERE material_id = $1`, [materialId, user.id, amount]);
    await audit(user.id, "material_stock.link_stock", "consumable_stock", link.stock_id, { material_id: materialId, before, after: before + amount }, req, c);
    return { updated: 1, stock: await fetchStock(c, link.stock_id) };
  }
  throw new MaterialError("未知的处理动作");
}
