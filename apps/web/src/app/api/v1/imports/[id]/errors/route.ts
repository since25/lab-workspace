import { requireUser } from "@/lib/auth";
import { csvResponse, toCsv } from "@/lib/csv";
import { query } from "@/lib/db";
import { HttpError, handle } from "@/lib/http";

// 下载某次导入的问题行清单（工作表、行号、原因）
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/v1/imports/[id]/errors">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const [b] = await query<{ dataset_type: string; error_summary: { sheet: string; row: number; message: string }[] }>(
    "SELECT dataset_type, error_summary FROM import_batches WHERE id = $1",
    [Number(id)]
  );
  if (!b) throw new HttpError(404, "导入记录不存在");
  if (b.dataset_type !== "cells" && user.role !== "admin") throw new HttpError(403, "需要管理员权限");
  return csvResponse(`import-${id}-errors.csv`, toCsv(["工作表", "行号", "原因"], b.error_summary.map((e) => [e.sheet, e.row, e.message])));
});
