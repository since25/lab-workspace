import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/http";
import { callLabelPrint, getPrintableMaterials, materialLabelRows, parseMaterialIds, parsePrintFields, parsePrintTemplate, requireLabelPrinting } from "@/lib/label-print";

export const POST = handle(async (req: Request) => {
  requireLabelPrinting(await requireUser());
  const body = await readJson(req);
  const template = parsePrintTemplate(body.template);
  const fields = parsePrintFields(body.fields);
  const items = await getPrintableMaterials(query, parseMaterialIds(body.ids));
  const result = await callLabelPrint("/api/preview", { rows: materialLabelRows(items, fields), layout: "two-up" });
  return ok({ ...result, template, fields, count: items.length });
});
