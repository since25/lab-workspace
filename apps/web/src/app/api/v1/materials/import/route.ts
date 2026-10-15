import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { parseMaterialWorkbook } from "@/lib/imports/materials";
import { readWorkbook } from "@/lib/imports/sheet";
import { importMaterialRows, validateMaterialKeys } from "@/lib/materials-data";
import { materialHandle } from "@/lib/materials-http";
import { readImportFile } from "@/lib/upload";

// 管理员预览后增量提交，不删除旧记录，不触碰本地已用完或待审批状态。
export const POST = materialHandle(async (req: Request) => {
  const user = await requireUser("admin");
  const { name, buf, mode } = await readImportFile(req);
  let sheets;
  try { sheets = await readWorkbook(buf, name); }
  catch (e) { throw new HttpError(400, (e as Error).message); }
  const { rows, issues, fatal } = parseMaterialWorkbook(sheets);
  if (fatal) throw new HttpError(400, fatal);
  if (issues.length) throw new HttpError(400, `有 ${issues.length} 条记录缺少物料编码，请修正后再导入`);
  validateMaterialKeys(rows);
  const summary = { total: rows.length, issues };
  if (mode !== "commit") return ok({ preview: true, ...summary, sample: rows.slice(0, 20) });
  const result = await withTransaction(c => importMaterialRows(c, rows, name, user.id, req));
  return ok({ committed: true, ...result, ...summary });
});
