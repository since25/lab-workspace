import { materialFilters, materialScope } from "./materials-data";
import { orderBy } from "./sort";

export interface MaterialQuery {
  <T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}
const PAGE = 50;
const SORTABLE: Record<string, string> = {
  requested_on: "m.requested_on", item_name: "m.item_name", brand: "m.brand", spec_model: "m.spec_model",
  quantity: "m.quantity", minor_category: "m.minor_category", project_code: "m.project_code",
  requester: "m.requester", receipt_status: "m.receipt_status", material_code: "m.material_code",
};
function pageFor(sp: URLSearchParams, total: number) {
  const requested = Math.max(1, Math.floor(Number(sp.get("page"))) || 1);
  return Math.min(requested, Math.max(1, Math.ceil(total / PAGE)));
}

export async function listMaterials(db: MaterialQuery, sp: URLSearchParams, departments: string[]) {
  const { where, params } = materialFilters(sp, departments);
  const [{ count }] = await db<{ count: string }>(`SELECT count(*) FROM material_items m WHERE ${where}`, params);
  const total = Number(count);
  const page = pageFor(sp, total);
  const items = await db(
    `SELECT m.*, to_char(m.requested_on, 'YYYY-MM-DD') AS requested_on, to_char(m.last_received_on, 'YYYY-MM-DD') AS last_received_on
     FROM material_items m WHERE ${where} ORDER BY ${orderBy(sp, SORTABLE, "m.requested_on DESC NULLS LAST, m.id DESC")}
     LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, params
  );
  const scope = materialScope(departments, sp.get("used_up") === "1");
  const facets = await db<{ col: string; v: string }>(
    `SELECT DISTINCT f.col, f.v FROM material_items m
     CROSS JOIN LATERAL (VALUES ('category', m.minor_category), ('status', m.status), ('receipt', m.receipt_status),
       ('brand', m.brand), ('requester', m.requester)) f(col, v)
     WHERE ${scope.where} AND f.v <> '' ORDER BY f.col, f.v`, scope.params
  );
  const [last] = await db<{ filename: string; created_at: string; accepted_count: number }>(
    "SELECT filename, created_at, accepted_count FROM import_batches WHERE dataset_type = 'materials' AND status = 'committed' ORDER BY id DESC LIMIT 1"
  );
  const [pending] = await db<{ count: string }>(
    "SELECT count(*) FROM material_items m WHERE m.department = ANY($1::text[]) AND NOT m.is_used_up AND m.used_up_requested_at IS NOT NULL", [departments]
  );
  const group = (col: string) => facets.filter(f => f.col === col).map(f => f.v);
  return { items, total, page, page_size: PAGE, departments, pending_count: Number(pending.count),
    facets: { category: group("category"), status: group("status"), receipt: group("receipt"), brand: group("brand"), requester: group("requester") },
    last_import: last ?? null };
}

export async function listUsageRequests(db: MaterialQuery, sp: URLSearchParams, departments: string[]) {
  const where = "m.department = ANY($1::text[]) AND NOT m.is_used_up AND m.used_up_requested_at IS NOT NULL";
  const [{ count }] = await db<{ count: string }>(`SELECT count(*) FROM material_items m WHERE ${where}`, [departments]);
  const total = Number(count);
  const page = pageFor(sp, total);
  const items = await db(
    `SELECT m.id, m.item_name, m.brand, m.spec_model, m.material_code, m.request_no, m.department,
       m.used_up_requested_at, u.display_name AS requested_by
     FROM material_items m LEFT JOIN users u ON u.id = m.used_up_requested_by WHERE ${where}
     ORDER BY m.used_up_requested_at, m.id LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, [departments]
  );
  return { items, total, page, page_size: PAGE };
}
