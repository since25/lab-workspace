import { HttpError, str } from "./http";
import { displayDepartments } from "./materials-data";
import { assetDisplayDepartments } from "./assets-list";
import { formatLocation } from "./freezer";
import { canViewAllFreezer, type SessionUser } from "./auth";
import type { MaterialQuery } from "./materials-list";

// 标签打印的数据来源：部门物料、冰箱样品、固定资产。
// 每个来源声明可打印字段（同时作为表格列）和取数 SQL，页面与接口都按这里生成，
// 新增来源只需要在 SOURCES 里加一项并补 FROM / WHERE 分支。
export type SourceKey = "materials" | "freezer" | "assets";
export type SourceField = { key: string; label: string };
export type SourceItem = Record<string, string | number | boolean> & { id: number };

export type SourceDef = {
  key: SourceKey;
  label: string;
  fields: SourceField[];
  columns: SourceField[];
};

export const SOURCES: SourceDef[] = [
  {
    key: "materials",
    label: "部门物料",
    fields: [
      { key: "item_name", label: "物料名称" },
      { key: "material_code", label: "物料编码" },
      { key: "spec_model", label: "规格型号" },
      { key: "brand", label: "品牌" },
      { key: "department", label: "部门" },
      { key: "unit", label: "单位" },
    ],
    columns: [
      { key: "item_name", label: "名称" },
      { key: "material_code", label: "物料编码" },
      { key: "brand", label: "品牌" },
      { key: "spec_model", label: "规格型号" },
      { key: "department", label: "部门" },
    ],
  },
  {
    key: "freezer",
    label: "冰箱样品",
    fields: [
      { key: "name", label: "样品信息" },
      { key: "project_no", label: "项目号" },
      { key: "sample_type", label: "样品类型" },
      { key: "location", label: "位置" },
      { key: "stored_on", label: "存入日期" },
      { key: "remarks", label: "备注" },
    ],
    columns: [
      { key: "name", label: "样品信息" },
      { key: "project_no", label: "项目号" },
      { key: "sample_type", label: "样品类型" },
      { key: "location", label: "位置" },
      { key: "stored_on", label: "存入日期" },
    ],
  },
  {
    key: "assets",
    label: "固定资产",
    fields: [
      { key: "asset_name", label: "资产名称" },
      { key: "asset_code", label: "资产编号" },
      { key: "spec_model", label: "规格型号" },
      { key: "location", label: "存放地点" },
      { key: "user_name", label: "使用人" },
      { key: "department", label: "使用部门" },
    ],
    columns: [
      { key: "asset_name", label: "名称" },
      { key: "asset_code", label: "资产编号" },
      { key: "spec_model", label: "规格型号" },
      { key: "location", label: "存放地点" },
      { key: "user_name", label: "使用人" },
    ],
  },
];

export const TEMPLATES = [
  { key: "name-detail", label: "名称 + 字段", hint: "名称大字，其余字段逐行；最常用" },
  { key: "uniform", label: "等宽全字段", hint: "名称与字段同字号，信息更紧凑" },
  { key: "name-only", label: "仅名称", hint: "超大名称，适合货架、抽屉" },
] as const;
export type TemplateKey = typeof TEMPLATES[number]["key"];
export const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key) as TemplateKey[];

export const MATERIAL_PAGE_SIZE = 20;

export function parseSource(value: unknown): SourceKey {
  const key = str(value) || "materials";
  if (!SOURCES.some((s) => s.key === key)) throw new HttpError(400, "未知的打印来源");
  return key as SourceKey;
}

export function parseTemplate(value: unknown): TemplateKey {
  const key = str(value) || "name-detail";
  if (!TEMPLATE_KEYS.includes(key as TemplateKey)) throw new HttpError(400, "不支持的标签模板");
  return key as TemplateKey;
}

export function sourceDef(key: SourceKey): SourceDef {
  const def = SOURCES.find((s) => s.key === key);
  if (!def) throw new HttpError(400, "未知的打印来源");
  return def;
}

export function parseSourceFields(source: SourceKey, value: unknown): string[] {
  const def = sourceDef(source);
  if (!Array.isArray(value)) throw new HttpError(400, "请选择至少一个打印字段");
  const fields = [...new Set(value.map((v) => str(v)))].filter((v) => def.fields.some((f) => f.key === v));
  if (!fields.length) throw new HttpError(400, "请选择至少一个有效打印字段");
  return fields;
}

const FROM: Record<SourceKey, string> = {
  materials: "material_items m",
  freezer: "freezer_samples s JOIN freezer_containers ct ON ct.id = s.container_id JOIN freezers f ON f.id = ct.freezer_id",
  assets: "fixed_assets a",
};

function listWhere(source: SourceKey, sp: URLSearchParams, user: SessionUser): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const q = (sp.get("q") ?? "").trim();
  const like = q ? `%${q}%` : "";
  const add = (v: unknown) => `$${params.push(v)}`;
  if (source === "materials") {
    // 部门范围沿用「部门物料」页面的展示配置。
    let where = `m.department = ANY(${add(displayDepartments())}::text[])`;
    if (q) where += ` AND (m.item_name ILIKE ${add(like)} OR m.material_code ILIKE ${add(like)} OR m.spec_model ILIKE ${add(like)} OR m.brand ILIKE ${add(like)})`;
    return { where, params };
  }
  if (source === "freezer") {
    // 在库样品才可打印；普通成员只看自己的，管理员或有「冰箱总览」的人看全部。
    let where = "s.status = 'stored'";
    if (!canViewAllFreezer(user)) where += ` AND s.owner_id = ${add(user.id)}`;
    if (q) where += ` AND (s.name ILIKE ${add(like)} OR s.project_no ILIKE ${add(like)} OR s.sample_type ILIKE ${add(like)} OR s.remarks ILIKE ${add(like)} OR ct.name ILIKE ${add(like)})`;
    return { where, params };
  }
  const departments = assetDisplayDepartments();
  let where = departments.includes("*") ? "true" : `a.department = ANY(${add(departments)}::text[])`;
  if (q) where += ` AND (a.asset_name ILIKE ${add(like)} OR a.asset_code ILIKE ${add(like)} OR a.asset_code_new ILIKE ${add(like)} OR a.spec_model ILIKE ${add(like)} OR a.location ILIKE ${add(like)})`;
  return { where, params };
}

const SELECT: Record<SourceKey, string> = {
  materials: `SELECT m.id, m.item_name, m.material_code, m.spec_model, m.brand, m.department, m.unit
                FROM ${FROM.materials}`,
  freezer: `SELECT s.id, s.name, s.project_no, s.sample_type, s.remarks,
                   to_char(s.stored_on, 'YYYY-MM-DD') AS stored_on,
                   f.name AS freezer_name, f.temperature, ct.shelf_no, ct.rack_no, ct.slot_no, ct.tier_no, ct.depth_no,
                   ct.kind AS container_kind, ct.name AS container_name
              FROM ${FROM.freezer}`,
  assets: `SELECT a.id, a.asset_name, COALESCE(NULLIF(a.asset_code_new, ''), NULLIF(a.asset_code, ''), '') AS asset_code,
                  a.spec_model, a.location, a.user_name, a.department
             FROM ${FROM.assets}`,
};

const ORDER: Record<SourceKey, string> = {
  materials: "m.item_name ASC, m.id ASC",
  freezer: "s.name ASC, s.id ASC",
  assets: "a.asset_name ASC, a.id ASC",
};

const ALIAS: Record<SourceKey, string> = { materials: "m", freezer: "s", assets: "a" };

// 冰箱样品把容器/冰箱信息拼成一行「位置」，与冰箱页面显示一致。
function withLocation(source: SourceKey, rows: SourceItem[]): SourceItem[] {
  if (source !== "freezer") return rows;
  return rows.map((row) => ({
    ...row,
    location: formatLocation({
      freezer_name: String(row.freezer_name ?? ""),
      temperature: String(row.temperature ?? ""),
      shelf_no: Number(row.shelf_no ?? 0),
      rack_no: row.rack_no === null || row.rack_no === undefined ? null : Number(row.rack_no),
      slot_no: row.slot_no === null || row.slot_no === undefined ? null : Number(row.slot_no),
      tier_no: row.tier_no === null || row.tier_no === undefined ? null : Number(row.tier_no),
      depth_no: row.depth_no === null || row.depth_no === undefined ? null : Number(row.depth_no),
      kind: String(row.container_kind ?? ""),
      name: String(row.container_name ?? ""),
    }),
  }));
}

export async function listSourceItems(db: MaterialQuery, source: SourceKey, sp: URLSearchParams, user: SessionUser) {
  const { where, params } = listWhere(source, sp, user);
  const pageSize = Math.min(Math.max(Number(sp.get("page_size")) || MATERIAL_PAGE_SIZE, 1), 100);
  const page = Math.max(Number(sp.get("page")) || 1, 1);
  const [{ count }] = await db<{ count: number }>(`SELECT count(*)::int AS count FROM ${FROM[source]} WHERE ${where}`, params);
  const rows = await db<SourceItem>(
    `${SELECT[source]} WHERE ${where} ORDER BY ${ORDER[source]} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params,
  );
  return { source, items: withLocation(source, rows), total: count, page, page_size: pageSize, fields: sourceDef(source).fields, columns: sourceDef(source).columns };
}

export async function getSourceItems(db: MaterialQuery, source: SourceKey, ids: number[], user: SessionUser): Promise<SourceItem[]> {
  const { where, params } = listWhere(source, new URLSearchParams(), user);
  const rows = await db<SourceItem>(
    `${SELECT[source]} WHERE ${where} AND ${ALIAS[source]}.id = ANY($${params.length + 1}::int[]) ORDER BY array_position($${params.length + 1}::int[], ${ALIAS[source]}.id)`,
    [...params, ids],
  );
  if (rows.length !== ids.length) throw new HttpError(404, "部分记录不存在或不在当前展示范围内，请刷新后重试");
  return withLocation(source, rows);
}

// 名称走 sample（大字），其余字段按「标签：值」逐行拼进 note；空值自动跳过。
// 自定义模板传 prefixes 时，字段前缀按模板原样拼（可为空，表示只打值）。
export function labelRows(items: SourceItem[], source: SourceKey, fields: string[], prefixes?: Record<string, string>) {
  const def = sourceDef(source);
  return items.map((item) => {
    const values = fields
      .map((key) => ({ key, label: def.fields.find((f) => f.key === key)?.label ?? key, value: String(item[key] ?? "").trim() }))
      .filter((v) => v.value);
    if (!values.length) throw new HttpError(400, `记录「${String(item.name ?? item.item_name ?? item.asset_name ?? item.id)}」没有可打印内容`);
    const [first, ...rest] = values;
    const prefix = (v: { key: string; label: string }) => prefixes && v.key in prefixes ? prefixes[v.key] : `${v.label}：`;
    return { sample: first.value, note: rest.map((v) => `${prefix(v)}${v.value}`).join("；") };
  });
}

// 供预览/打印接口复用的入参校验
export function parseItemIds(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 500 || value.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new HttpError(400, "请选择 1 至 500 条有效记录");
  }
  return [...new Set(value as number[])];
}

export function parseCopies(value: unknown): number {
  const copies = Number(value ?? 1);
  if (!Number.isSafeInteger(copies) || copies < 1 || copies > 20) throw new HttpError(400, "份数必须是 1 至 20 的整数");
  return copies;
}
