import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { HttpError, handle, ok } from "@/lib/http";
import { type MaterialRow, parseMaterialWorkbook } from "@/lib/imports/materials";
import { readWorkbook } from "@/lib/imports/sheet";
import { readImportFile } from "@/lib/upload";

const COLS: (keyof MaterialRow)[] = [
  "requested_on", "requester", "department", "request_no", "material_code", "status", "major_category", "minor_category",
  "item_name", "brand", "spec_model", "unit", "quantity", "is_urgent", "project_code", "remarks", "order_no",
  "purchased_qty", "last_received_on", "received_qty", "receipt_status",
];

// 管理员导入采购系统导出：preview 只预览；commit 在一个事务内整表替换，失败则保留旧数据
export const POST = handle(async (req: Request) => {
  const user = await requireUser("admin");
  const { name, buf, mode } = await readImportFile(req);
  let sheets;
  try {
    sheets = await readWorkbook(buf, name);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const { rows, issues, fatal } = parseMaterialWorkbook(sheets);
  if (fatal) throw new HttpError(400, fatal);
  const summary = { total: rows.length, issues };
  if (mode !== "commit") return ok({ preview: true, ...summary, sample: rows.slice(0, 20) });
  if (!rows.length) throw new HttpError(400, "文件里没有可导入的记录");

  const batchId = await withTransaction(async (c) => {
    const b = await c.query<{ id: number }>(
      `INSERT INTO import_batches(dataset_type, filename, row_count, accepted_count, rejected_count, status, error_summary, created_by)
       VALUES ('materials', $1, $2, $3, $4, 'committed', $5, $6) RETURNING id`,
      [name, rows.length + issues.length, rows.length, issues.length, JSON.stringify(issues), user.id]
    );
    const id = b.rows[0].id;
    const removed = (await c.query("DELETE FROM material_items")).rowCount ?? 0;
    // 分批插入，每批 200 行
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const vals: unknown[] = [];
      const tuples = chunk.map((r) => {
        const start = vals.length;
        COLS.forEach((k) => vals.push(r[k]));
        vals.push(id);
        return `(${Array.from({ length: COLS.length + 1 }, (_, j) => `$${start + j + 1}`).join(",")})`;
      });
      await c.query(`INSERT INTO material_items(${COLS.join(",")}, import_batch_id) VALUES ${tuples.join(",")}`, vals);
    }
    await audit(user.id, "material.import_replace", "import_batch", id, { filename: name, inserted: rows.length, removed, issues: issues.length }, req, c);
    return id;
  });
  return ok({ committed: true, batch_id: batchId, ...summary });
});
