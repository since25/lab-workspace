import ExcelJS from "exceljs";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { cellFilter } from "@/lib/cells";
import { query } from "@/lib/db";
import { handle } from "@/lib/http";

const COLUMNS: [string, string, number][] = [
  ["rack_no", "架号", 8], ["layer_no", "层", 6], ["cell_name", "细胞名称", 24], ["source", "来源", 16], ["passage", "代次", 8],
  ["density", "细胞密度", 12], ["freezing_medium", "冻存液", 14], ["tube_count", "管数", 8], ["depositor", "存放人", 10],
  ["frozen_on", "放入时间", 12], ["remarks", "备注", 24], ["needs_review", "待核对", 8],
];

// 导出 Excel：带 ids 时只导出勾选的记录，否则按与列表相同的筛选条件导出全部结果
export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const { where, params } = cellFilter(new URL(req.url).searchParams);
  const rows = await query<Record<string, unknown>>(
    `SELECT c.*, coalesce(to_char(c.frozen_on, 'YYYY-MM-DD'), c.frozen_on_raw) AS frozen_on,
            coalesce(c.tube_count::text, c.tube_count_raw) AS tube_count
       FROM cell_inventory c ${where} ORDER BY c.rack_no, c.layer_no, c.id`,
    params
  );
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("细胞冻存");
  ws.columns = COLUMNS.map(([key, header, width]) => ({ key, header, width }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) {
    ws.addRow({ ...r, tube_count: r.tube_count !== "" && !isNaN(Number(r.tube_count)) ? Number(r.tube_count) : r.tube_count, needs_review: r.needs_review ? "是" : "" });
  }
  const buf = await wb.xlsx.writeBuffer();
  await audit(user.id, "cell.export", "cell", "", { count: rows.length }, req);
  const name = `细胞冻存_${new Date().toLocaleDateString("sv-SE")}.xlsx`;
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
});
