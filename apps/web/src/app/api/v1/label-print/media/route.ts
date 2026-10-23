import { handle, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { callLabelPrint, requireLabelPrinting } from "@/lib/label-print";

// 纸张尺寸由标签服务提供，页面只做展示与等比预览，避免两边各写一份毫米数。
export const GET = handle(async () => {
  requireLabelPrinting(await requireUser());
  return ok(await callLabelPrint("/api/media"));
});
