import { HttpError } from "./http";
import { orderBy } from "./sort";

// 固定资产查询层：台账全量入库，页面能看哪些部门由配置决定，其余靠查询参数筛选。
// 三种视图（汇总 / 明细 / 展开）共用同一套筛选，保证「汇总的地点条数」与展开后的明细一致。
export interface AssetQuery {
  <T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export type AssetView = "group" | "item" | "detail";

// 汇总视图一行代表一个「名称＋规格型号＋使用部门」的物品，行数远少于明细；明细仍保持 50 条一页。
export const GROUP_PAGE = 100;
export const ITEM_PAGE = 50;
export const DETAIL_LIMIT = 500;

const ITEM_SORTABLE: Record<string, string> = {
  asset_name: "asset_name", spec_model: "spec_model", category: "category", quantity: "quantity",
  location: "location", user_name: "user_name", department: "department",
  // 空编号当成 NULL，点表头排序时没有编号的行排到最后而不是最前
  asset_code: "nullif(asset_code, '')", asset_code_new: "nullif(asset_code_new, '')",
};
const GROUP_SORTABLE: Record<string, string> = {
  asset_name: "asset_name", spec_model: "spec_model", department: "department",
  category: "string_agg(DISTINCT nullif(category, ''), '、')",
  item_count: "count(*)", total_quantity: "sum(quantity)", location_count: "count(DISTINCT location)",
};

export interface AssetLocation {
  location: string;
  item_count: number;
  total_quantity: string | null;
}
export interface AssetGroup {
  asset_name: string;
  spec_model: string;
  department: string;
  category: string | null;
  user_names: string | null;
  item_count: number;
  total_quantity: string | null;
  location_count: number;
  locations: AssetLocation[];
}

export function assetView(sp: URLSearchParams): AssetView {
  const view = (sp.get("view") ?? "").trim();
  return view === "item" || view === "detail" ? view : "group";
}

// 展示范围：`ASSET_DISPLAY_DEPARTMENTS_JSON` 配置的部门数组；含 "*" 表示不限部门；未配置时默认只展示研发部。
// 配置无效时宁可报错也不静默展示别的部门。
export function assetDisplayDepartments(raw = process.env.ASSET_DISPLAY_DEPARTMENTS_JSON): string[] {
  if (!raw) return ["研发部"];
  try {
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values) || values.some((v) => typeof v !== "string" || !v.trim())) throw new Error();
    const list = [...new Set((values as string[]).map((v) => v.trim()))];
    return list.includes("*") ? [] : list;
  } catch {
    throw new HttpError(503, "固定资产展示部门配置无效，请联系管理员");
  }
}

// 关键词同时匹配名称、规格型号与两套资产编号；类别、存放地点、使用部门为精确匹配。
export function assetFilters(sp: URLSearchParams, scope: string[]) {
  const where: string[] = [];
  const params: unknown[] = [];
  const param = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (scope.length) where.push(`department = ANY(${param(scope)}::text[])`);
  const q = (sp.get("q") ?? "").trim();
  if (q) {
    const like = param(`%${q}%`);
    where.push(`(asset_name ILIKE ${like} OR spec_model ILIKE ${like} OR asset_code ILIKE ${like} OR asset_code_new ILIKE ${like})`);
  }
  const user = (sp.get("user") ?? "").trim();
  if (user) where.push(`user_name ILIKE ${param(`%${user}%`)}`);
  const department = (sp.get("department") ?? "").trim();
  if (department && (!scope.length || scope.includes(department))) where.push(`department = ${param(department)}`);
  for (const [key, col] of [["category", "category"], ["location", "location"]] as const) {
    const v = (sp.get(key) ?? "").trim();
    if (v) where.push(`${col} = ${param(v)}`);
  }
  return { clause: where.length ? "WHERE " + where.join(" AND ") : "", params };
}

function pageFor(sp: URLSearchParams, total: number, size: number) {
  const requested = Math.max(1, Math.floor(Number(sp.get("page"))) || 1);
  return Math.min(requested, Math.max(1, Math.ceil(total / size)));
}

const groupKey = (name: string, spec: string, department: string) => `${name}\u0000${spec}\u0000${department}`;

// 汇总视图：左侧一列一个物品，locations 给出该物品在各存放地点的条数。
export async function listAssetGroups(db: AssetQuery, sp: URLSearchParams, scope: string[]) {
  const { clause, params } = assetFilters(sp, scope);
  const [{ count }] = await db<{ count: string }>(
    `SELECT count(*) FROM (SELECT 1 FROM fixed_assets ${clause} GROUP BY asset_name, spec_model, department) g`, params
  );
  const total = Number(count);
  const page = pageFor(sp, total, GROUP_PAGE);
  const groups = await db<Omit<AssetGroup, "locations">>(
    `SELECT asset_name, spec_model, department,
       string_agg(DISTINCT nullif(category, ''), '、') AS category,
       string_agg(DISTINCT nullif(user_name, ''), '、') AS user_names,
       count(*)::int AS item_count,
       sum(quantity)::numeric AS total_quantity,
       count(DISTINCT location)::int AS location_count
     FROM fixed_assets ${clause}
     GROUP BY asset_name, spec_model, department
     ORDER BY ${orderBy(sp, GROUP_SORTABLE, "asset_name, spec_model, department")}
     LIMIT ${GROUP_PAGE} OFFSET ${(page - 1) * GROUP_PAGE}`, params
  );
  // 地点分布单独查一次：用同样一组筛选条件，且只取当前页的分组
  const tuples = groups.map((_, i) => `($${params.length + i * 3 + 1}, $${params.length + i * 3 + 2}, $${params.length + i * 3 + 3})`).join(",");
  const locations = groups.length
    ? await db<AssetLocation & { asset_name: string; spec_model: string; department: string }>(
        `SELECT asset_name, spec_model, department, location, count(*)::int AS item_count, sum(quantity)::numeric AS total_quantity
         FROM fixed_assets ${clause ? clause + " AND" : "WHERE"} (asset_name, spec_model, department) IN (${tuples})
         GROUP BY asset_name, spec_model, department, location
         ORDER BY count(*) DESC, location`,
        [...params, ...groups.flatMap((g) => [g.asset_name, g.spec_model, g.department])]
      )
    : [];
  const byGroup = new Map<string, AssetLocation[]>();
  for (const { asset_name, spec_model, department, ...loc } of locations) {
    const k = groupKey(asset_name, spec_model, department);
    const list = byGroup.get(k) ?? [];
    list.push(loc);
    byGroup.set(k, list);
  }
  return {
    groups: groups.map((g) => ({ ...g, locations: byGroup.get(groupKey(g.asset_name, g.spec_model, g.department)) ?? [] })) as AssetGroup[],
    total,
    page,
    page_size: GROUP_PAGE,
    departments: scope,
  };
}

// 明细视图：一行一条资产。
export async function listAssetItems(db: AssetQuery, sp: URLSearchParams, scope: string[]) {
  const { clause, params } = assetFilters(sp, scope);
  const [{ count }] = await db<{ count: string }>(`SELECT count(*) FROM fixed_assets ${clause}`, params);
  const total = Number(count);
  const page = pageFor(sp, total, ITEM_PAGE);
  const items = await db(
    `SELECT * FROM fixed_assets ${clause} ORDER BY ${orderBy(sp, ITEM_SORTABLE, "asset_name, spec_model, id")}
     LIMIT ${ITEM_PAGE} OFFSET ${(page - 1) * ITEM_PAGE}`, params
  );
  return { items, total, page, page_size: ITEM_PAGE, departments: scope };
}

// 展开某个分组的明细：沿用当前筛选，按地点和编号排序，条数有上限防止异常数据拖慢页面。
export async function listAssetGroupItems(db: AssetQuery, sp: URLSearchParams, scope: string[]) {
  const { clause, params } = assetFilters(sp, scope);
  const name = sp.get("name") ?? "";
  const spec = sp.get("spec") ?? "";
  const department = sp.get("group_department") ?? "";
  const items = await db(
    `SELECT * FROM fixed_assets ${clause ? clause + " AND" : "WHERE"} asset_name = $${params.length + 1}
       AND spec_model = $${params.length + 2} AND department = $${params.length + 3}
     ORDER BY location, asset_code_new, asset_code, id LIMIT ${DETAIL_LIMIT}`, [...params, name, spec, department]
  );
  return { items, limit: DETAIL_LIMIT };
}

// 下拉候选与最近一次导入批次：列表视图都要返回，保持页面信息一致。候选只覆盖展示范围内的部门。
export async function assetMeta(db: AssetQuery, scope: string[]) {
  const params = scope.length ? [scope] : [];
  const cond = (extra: string) => (scope.length ? `WHERE department = ANY($1::text[]) AND ${extra}` : `WHERE ${extra}`);
  const facets = await db<{ col: string; v: string }>(
    `SELECT DISTINCT 'category' AS col, category AS v FROM fixed_assets ${cond("category <> ''")}
     UNION SELECT DISTINCT 'location', location FROM fixed_assets ${cond("location <> ''")}
     UNION SELECT DISTINCT 'department', department FROM fixed_assets ${cond("department <> ''")}
     ORDER BY 1, 2`, params
  );
  const [last] = await db<{ filename: string; created_at: string; accepted_count: number }>(
    "SELECT filename, created_at, accepted_count FROM import_batches WHERE dataset_type = 'assets' AND status = 'committed' ORDER BY id DESC LIMIT 1"
  );
  // 整表替换覆盖所有部门，导入确认前要给出真正会被替换的条数（与当前筛选、展示范围无关）
  const [{ count }] = await db<{ count: string }>("SELECT count(*) FROM fixed_assets");
  const group = (col: string) => facets.filter((f) => f.col === col).map((f) => f.v);
  return {
    facets: { category: group("category"), location: group("location"), department: group("department") },
    last_import: last ?? null,
    total_rows: Number(count),
  };
}
