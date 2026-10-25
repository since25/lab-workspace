import { handle, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { callLabelPrint, requireLabelPrinting } from "@/lib/label-print";

// 纸张尺寸由标签服务提供，页面只做展示与等比预览，避免两边各写一份毫米数。
// 支持按 ?printer_id=... 查询对应打印机的介质参数。
export const GET = handle(async (req: Request) => {
  requireLabelPrinting(await requireUser());
  const url = new URL(req.url);
  const printerId = url.searchParams.get("printer_id") || "";
  const query = printerId ? `?printer_id=${encodeURIComponent(printerId)}` : "";
  return ok(await callLabelPrint(`/api/media${query}`));
});
