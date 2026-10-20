import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { HttpError, handle, ok } from "@/lib/http";
import { type AssetRow, assetDepartments, parseAssetWorkbook } from "@/lib/imports/assets";
import { readWorkbook } from "@/lib/imports/sheet";
import { readImportFile } from "@/lib/upload";

const COLS: (keyof AssetRow)[] = [
  "asset_code", "asset_code_new", "asset_name", "spec_model", "category", "quantity", "location", "department", "user_name",
];

// 管理员导入固定资产台账：preview 只预览；commit 整表替换，失败保留旧数据
export const POST = handle(async (req: Request) => {
  const user = await requireUser("admin");
  const { name, buf, mode } = await readImportFile(req);
  let sheets;
  try {
    sheets = await readWorkbook(buf, name);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const { rows, issues, fatal, sheets_used } = parseAssetWorkbook(sheets);
  if (fatal) throw new HttpError(400, fatal);
  // 台账全量入库，预览里按部门给出条数，管理员确认后再整表替换
  const summary = { total: rows.length, sheets_used, issues, departments: assetDepartments(rows) };
  if (mode !== "commit") return ok({ preview: true, ...summary, sample: rows.slice(0, 20) });
  if (!rows.length) throw new HttpError(400, "文件里没有可导入的资产");
  const batchId = await withTransaction(async (c) => {
    const b = await c.query<{ id: number }>(
      `INSERT INTO import_batches(dataset_type, filename, row_count, accepted_count, rejected_count, status, error_summary, created_by)
       VALUES ('assets', $1, $2, $3, $4, 'committed', $5, $6) RETURNING id`,
      [name, rows.length + issues.length, rows.length, issues.length, JSON.stringify(issues), user.id]
    );
    const id = b.rows[0].id;
    const removed = (await c.query("DELETE FROM fixed_assets")).rowCount ?? 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const vals: unknown[] = [];
      const tuples = chunk.map((r) => {
        const start = vals.length;
        COLS.forEach((k) => vals.push(r[k]));
        vals.push(id);
        return `(${Array.from({ length: COLS.length + 1 }, (_, j) => `$${start + j + 1}`).join(",")})`;
      });
      await c.query(`INSERT INTO fixed_assets(${COLS.join(",")}, import_batch_id) VALUES ${tuples.join(",")}`, vals);
    }
    await audit(user.id, "asset.import_replace", "import_batch", id, { filename: name, inserted: rows.length, removed, skipped: issues.length }, req, c);
    return id;
  });
  return ok({ committed: true, batch_id: batchId, ...summary });
});
