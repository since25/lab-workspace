import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, ok, str } from "@/lib/http";
import { orderBy } from "@/lib/sort";

const PAGE = 50;
const SORTABLE: Record<string, string> = {
  requested_on: "m.requested_on", item_name: "m.item_name", brand: "m.brand", spec_model: "m.spec_model",
  quantity: "m.quantity", minor_category: "m.minor_category", project_code: "m.project_code",
  requester: "m.requester", receipt_status: "m.receipt_status", material_code: "m.material_code",
};

// 采购记录查询：关键词 + 小类/状态/收货状态筛选，按请购日期倒序分页
export const GET = handle(async (req: Request) => {
  await requireUser();
  const sp = new URL(req.url).searchParams;
  const where: string[] = [];
  const params: unknown[] = [];
  const q = str(sp.get("q"));
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    where.push(
      `(item_name ILIKE ${p} OR brand ILIKE ${p} OR spec_model ILIKE ${p} OR material_code ILIKE ${p} OR requester ILIKE ${p} OR project_code ILIKE ${p} OR request_no ILIKE ${p})`
    );
  }
  for (const [param, col] of [["brand", "brand"], ["requester", "requester"]] as const) {
    const v = str(sp.get(param));
    if (v) {
      params.push(`%${v}%`);
      where.push(`${col} ILIKE $${params.length}`);
    }
  }
  for (const [param, col] of [["category", "minor_category"], ["status", "status"], ["receipt", "receipt_status"]] as const) {
    const v = str(sp.get(param));
    if (v) {
      params.push(v);
      where.push(`${col} = $${params.length}`);
    }
  }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const [{ count }] = await query<{ count: string }>(`SELECT count(*) FROM material_items ${w}`, params);
  const items = await query(
    `SELECT m.*, to_char(m.requested_on, 'YYYY-MM-DD') AS requested_on, to_char(m.last_received_on, 'YYYY-MM-DD') AS last_received_on
       FROM material_items m ${w} ORDER BY ${orderBy(sp, SORTABLE, "m.requested_on DESC NULLS LAST, m.id DESC")} LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
    params
  );
  const facets = await query<{ col: string; v: string }>(
    `SELECT DISTINCT 'category' AS col, minor_category AS v FROM material_items WHERE minor_category <> ''
     UNION SELECT DISTINCT 'status', status FROM material_items WHERE status <> ''
     UNION SELECT DISTINCT 'receipt', receipt_status FROM material_items WHERE receipt_status <> '' ORDER BY 1, 2`
  );
  const [last] = await query<{ filename: string; created_at: string; accepted_count: number }>(
    "SELECT filename, created_at, accepted_count FROM import_batches WHERE dataset_type = 'materials' AND status = 'committed' ORDER BY id DESC LIMIT 1"
  );
  const group = (c: string) => facets.filter((f) => f.col === c).map((f) => f.v);
  return ok({
    items,
    total: Number(count),
    page,
    page_size: PAGE,
    facets: { category: group("category"), status: group("status"), receipt: group("receipt") },
    last_import: last ?? null,
  });
});
