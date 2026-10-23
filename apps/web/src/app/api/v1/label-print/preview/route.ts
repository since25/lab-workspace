import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/http";
import { callLabelPrint, requireLabelPrinting } from "@/lib/label-print";
import { getSourceItems, labelRows, parseItemIds, parseSource, parseSourceFields, parseTemplate } from "@/lib/label-sources";

export const POST = handle(async (req: Request) => {
  const user = requireLabelPrinting(await requireUser());
  const body = await readJson(req);
  const source = parseSource(body.source);
  const template = parseTemplate(body.template);
  const fields = parseSourceFields(source, body.fields);
  const items = await getSourceItems(query, source, parseItemIds(body.ids), user);
  const result = await callLabelPrint("/api/preview", { rows: labelRows(items, source, fields), layout: "two-up", template });
  return ok({ ...result, source, template, fields, count: items.length });
});
