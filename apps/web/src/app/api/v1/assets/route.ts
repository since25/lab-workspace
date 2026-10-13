import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, ok, str } from "@/lib/http";
import { orderBy } from "@/lib/sort";

const PAGE = 50;
const SORTABLE: Record<string, string> = {
  asset_name: "asset_name", spec_model: "spec_model", category: "category", quantity: "quantity",
  location: "location", user_name: "user_name",
};

// 固定资产查询：关键词、使用人、类别、存放地点筛选，可排序分页
export const GET = handle(async (req: Request) => {
  await requireUser();
  const sp = new URL(req.url).searchParams;
  const where: string[] = [];
  const params: unknown[] = [];
  const q = str(sp.get("q"));
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    where.push(`(asset_name ILIKE ${p} OR spec_model ILIKE ${p})`);
  }
  const user = str(sp.get("user"));
  if (user) {
    params.push(`%${user}%`);
    where.push(`user_name ILIKE $${params.length}`);
  }
  for (const [param, col] of [["category", "category"], ["location", "location"]] as const) {
    const v = str(sp.get(param));
    if (v) {
      params.push(v);
      where.push(`${col} = $${params.length}`);
    }
  }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const [{ count }] = await query<{ count: string }>(`SELECT count(*) FROM fixed_assets ${w}`, params);
  const items = await query(
    `SELECT * FROM fixed_assets ${w} ORDER BY ${orderBy(sp, SORTABLE, "asset_name, id")} LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
    params
  );
  const facets = await query<{ col: string; v: string }>(
    `SELECT DISTINCT 'category' AS col, category AS v FROM fixed_assets WHERE category <> ''
     UNION SELECT DISTINCT 'location', location FROM fixed_assets WHERE location <> '' ORDER BY 1, 2`
  );
  const [last] = await query<{ filename: string; created_at: string; accepted_count: number }>(
    "SELECT filename, created_at, accepted_count FROM import_batches WHERE dataset_type = 'assets' AND status = 'committed' ORDER BY id DESC LIMIT 1"
  );
  const group = (c: string) => facets.filter((f) => f.col === c).map((f) => f.v);
  return ok({
    items,
    total: Number(count),
    page,
    page_size: PAGE,
    facets: { category: group("category"), location: group("location") },
    last_import: last ?? null,
  });
});
