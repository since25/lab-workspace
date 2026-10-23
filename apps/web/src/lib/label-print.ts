import { HttpError, str } from "./http";
import type { SessionUser } from "./auth";
import type { MaterialQuery } from "./materials-list";
import { displayDepartments, materialFilters } from "./materials-data";
import { orderBy } from "./sort";

export const PRINT_TEMPLATE = "material-v1";
export const PRINT_FIELDS = [
  { key: "item_name", label: "物料名称" },
  { key: "material_code", label: "物料编码" },
  { key: "spec_model", label: "规格型号" },
  { key: "brand", label: "品牌" },
] as const;
export type PrintField = typeof PRINT_FIELDS[number]["key"];

export type PrintableMaterial = {
  id: number;
  item_name: string;
  material_code: string;
  brand: string;
  spec_model: string;
  unit: string;
  department: string;
  requester: string;
  is_used_up: boolean;
};

export function requireLabelPrinting(user: SessionUser) {
  if (!user.label_print_enabled) throw new HttpError(404, "当前租户未开放标签打印");
  return user;
}

export function parsePrintFields(value: unknown): PrintField[] {
  if (!Array.isArray(value)) throw new HttpError(400, "请选择至少一个打印字段");
  const fields = [...new Set(value.map((v) => str(v)))].filter((v): v is PrintField => PRINT_FIELDS.some((f) => f.key === v));
  if (!fields.length || fields.length > 4) throw new HttpError(400, "请选择 1 至 4 个有效打印字段");
  return fields;
}

export function parsePrintTemplate(value: unknown) {
  if (str(value) !== PRINT_TEMPLATE) throw new HttpError(400, "不支持的标签模板");
  return PRINT_TEMPLATE;
}

export function parseMaterialIds(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 500 || value.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new HttpError(400, "请选择 1 至 500 条有效物料");
  }
  return [...new Set(value as number[])];
}

export function materialLabelRows(items: PrintableMaterial[], fields: PrintField[]) {
  const label = (item: PrintableMaterial, field: PrintField) => String(item[field] ?? "").trim();
  return items.map((item) => {
    const values = fields.map((field) => ({ label: PRINT_FIELDS.find((f) => f.key === field)!.label, value: label(item, field) }))
      .filter((v) => v.value);
    if (!values.length) throw new HttpError(400, `物料「${item.item_name || item.material_code}」没有可打印内容`);
    const [first, ...rest] = values;
    return { sample: first.value, note: rest.map((v) => `${v.label}：${v.value}`).join("；") };
  });
}

export async function listPrintableMaterials(db: MaterialQuery, sp: URLSearchParams) {
  const departments = displayDepartments();
  const { where, params } = materialFilters(sp, departments);
  const items = await db<PrintableMaterial>(
    `SELECT m.id, m.item_name, m.material_code, m.brand, m.spec_model, m.unit, m.department, m.requester, m.is_used_up
       FROM material_items m WHERE ${where}
      ORDER BY ${orderBy(sp, {
        requested_on: "m.requested_on", item_name: "m.item_name", material_code: "m.material_code", brand: "m.brand", spec_model: "m.spec_model",
      }, "m.item_name ASC, m.id ASC")} LIMIT 500`,
    params,
  );
  return { items, total: items.length, departments, limit: 500, fields: PRINT_FIELDS };
}

export async function getPrintableMaterials(db: MaterialQuery, ids: number[]) {
  const departments = displayDepartments();
  const rows = await db<PrintableMaterial>(
    `SELECT id, item_name, material_code, brand, spec_model, unit, department, requester, is_used_up
       FROM material_items WHERE id = ANY($1::int[]) AND department = ANY($2::text[]) AND NOT is_used_up
      ORDER BY array_position($1::int[], id)`,
    [ids, departments],
  );
  if (rows.length !== ids.length) throw new HttpError(404, "部分物料不存在、已用完或不在当前展示范围内，请刷新后重试");
  return rows;
}

export type Printer = { id: number; printer_key: string; name: string; enabled: boolean; is_default: boolean; ready?: boolean; reason?: string; jobs?: number; notes?: string };

export async function listPrinters(db: MaterialQuery, includeDisabled = false) {
  const rows = await db<Printer>(`SELECT id, printer_key, name, enabled, is_default FROM label_printers ${includeDisabled ? "" : "WHERE enabled"} ORDER BY is_default DESC, name, id`);
  return rows;
}

export async function callLabelPrint(path: string, body?: unknown) {
  const base = (process.env.LABELPRINT_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new HttpError(503, `标签打印服务不可用：${e instanceof Error ? e.message : String(e)}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status === 409 ? 409 : 503, data.error || "标签打印服务返回失败");
  return data as Record<string, unknown>;
}
