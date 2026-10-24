import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { requireLabelPrinting } from "@/lib/label-print";
import { parseSource } from "@/lib/label-sources";
import { listTemplates } from "@/lib/label-templates";

// 打印页按来源列出可选用的自定义模板；能打印的人都可选用，编辑仅限管理员。
export const GET = handle(async (req: Request) => {
  requireLabelPrinting(await requireUser());
  const source = parseSource(new URL(req.url).searchParams.get("source"));
  return ok({ templates: await listTemplates(query, source) });
});
