import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { HttpError, handle, ok } from "@/lib/http";
import { type CellRow, parseCellWorkbook } from "@/lib/imports/cells";
import { readWorkbook } from "@/lib/imports/sheet";
import { readImportFile } from "@/lib/upload";

const key = (r: Pick<CellRow, "rack_no" | "layer_no" | "cell_name" | "depositor" | "tube_count_raw" | "frozen_on_raw">) =>
  [r.rack_no, r.layer_no, r.cell_name, r.depositor, r.tube_count_raw, r.frozen_on_raw].join("\u0001");

// 导入细胞登记表：mode=preview 只解析返回预览；mode=commit 写入（追加，跳过与现有记录完全相同的行）
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const { name, buf, mode } = await readImportFile(req);
  let sheets;
  try {
    sheets = await readWorkbook(buf, name);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const { rows, issues } = parseCellWorkbook(sheets);
  const existing = new Set(
    (await query<CellRow>("SELECT rack_no, layer_no, cell_name, depositor, tube_count_raw, frozen_on_raw FROM cell_inventory")).map(key)
  );
  const fresh = rows.filter((r) => !existing.has(key(r)));
  const summary = {
    total: rows.length,
    new_rows: fresh.length,
    duplicates: rows.length - fresh.length,
    review: fresh.filter((r) => r.needs_review).length,
    issues,
  };
  if (mode !== "commit") return ok({ preview: true, ...summary, sample: fresh.slice(0, 30) });
  if (!rows.length) throw new HttpError(400, "文件里没有可导入的记录");

  const batchId = await withTransaction(async (c) => {
    const b = await c.query<{ id: number }>(
      `INSERT INTO import_batches(dataset_type, filename, row_count, accepted_count, rejected_count, review_count, status, error_summary, created_by)
       VALUES ('cells', $1, $2, $3, $4, $5, 'committed', $6, $7) RETURNING id`,
      [name, rows.length + issues.length, fresh.length, issues.length, summary.review, JSON.stringify(issues), user.id]
    );
    const id = b.rows[0].id;
    for (const r of fresh) {
      await c.query(
        `INSERT INTO cell_inventory(rack_no, layer_no, cell_name, source, passage, density, freezing_medium, tube_count,
           tube_count_raw, depositor, frozen_on, frozen_on_raw, needs_review, review_reason, import_batch_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [r.rack_no, r.layer_no, r.cell_name, r.source, r.passage, r.density, r.freezing_medium, r.tube_count,
          r.tube_count_raw, r.depositor, r.frozen_on, r.frozen_on_raw, r.needs_review, r.review_reason, id, user.id]
      );
    }
    await audit(user.id, "cell.import", "import_batch", id, { filename: name, inserted: fresh.length, duplicates: summary.duplicates, issues: issues.length }, req, c);
    return id;
  });
  return ok({ committed: true, batch_id: batchId, ...summary });
});
