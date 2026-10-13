import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { CELL_OPTION_FIELDS, cellFilter, parseCellInput } from "@/lib/cells";
import { query } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/http";

const LIST_SQL = `SELECT c.*, to_char(c.frozen_on, 'YYYY-MM-DD') AS frozen_on FROM cell_inventory c`;

export const GET = handle(async (req: Request) => {
  await requireUser();
  const { where, params } = cellFilter(new URL(req.url).searchParams);
  const cells = await query(`${LIST_SQL} ${where} ORDER BY c.rack_no, c.layer_no, c.id LIMIT 2000`, params);
  const [stats] = await query<{ total: string; review: string; racks: number[] }>(
    "SELECT count(*) AS total, count(*) FILTER (WHERE needs_review) AS review, coalesce(array_agg(DISTINCT rack_no ORDER BY rack_no), '{}') AS racks FROM cell_inventory"
  );
  // 下拉候选：台账里已有的值（去空、去重）
  const optionRows = await query<{ col: string; v: string }>(
    CELL_OPTION_FIELDS.map((f) => `SELECT DISTINCT '${f}' AS col, ${f} AS v FROM cell_inventory WHERE ${f} <> ''`).join(" UNION ") + " ORDER BY 1, 2"
  );
  const options = Object.fromEntries(CELL_OPTION_FIELDS.map((f) => [f, optionRows.filter((r) => r.col === f).map((r) => r.v)]));
  return ok({ cells, stats: { total: Number(stats.total), review: Number(stats.review), racks: stats.racks }, options });
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const c = parseCellInput(await readJson(req), false);
  const [row] = await query<{ id: number }>(
    `INSERT INTO cell_inventory(rack_no, layer_no, cell_name, source, passage, density, freezing_medium,
       tube_count, tube_count_raw, depositor, frozen_on, frozen_on_raw, remarks, needs_review, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,$14) RETURNING id`,
    [c.rack_no, c.layer_no, c.cell_name, c.source, c.passage, c.density, c.freezing_medium,
      c.tube_count, c.tube_count == null ? "" : String(c.tube_count), c.depositor, c.frozen_on, c.frozen_on ?? "", c.remarks, user.id]
  );
  await audit(user.id, "cell.create", "cell", row.id, { cell_name: c.cell_name, rack_no: c.rack_no, layer_no: c.layer_no, tube_count: c.tube_count }, req);
  return ok({ id: row.id }, 201);
});
