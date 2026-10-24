import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, HttpError, ok, readJson } from "@/lib/http";
import { callLabelPrint, requireLabelPrinting } from "@/lib/label-print";
import { getSourceItems, labelRows, parseItemIds, parseSource, parseSourceFields } from "@/lib/label-sources";
import { parseTemplateDraft, resolveDraft, resolveTemplate } from "@/lib/label-templates";

export const POST = handle(async (req: Request) => {
  const user = requireLabelPrinting(await requireUser());
  const body = await readJson(req);
  const source = parseSource(body.source);
  // draft：模板编辑页用未保存的参数预览，仅管理员可用
  let resolved;
  if (body.draft !== undefined) {
    if (user.role !== "admin") throw new HttpError(403, "只有管理员可以编辑标签模板");
    resolved = resolveDraft(parseTemplateDraft({ ...(body.draft as Record<string, unknown>), source }));
  } else {
    resolved = await resolveTemplate(query, source, body);
  }
  const fields = resolved.fields ?? parseSourceFields(source, body.fields);
  const items = await getSourceItems(query, source, parseItemIds(body.ids), user);
  const result = await callLabelPrint("/api/preview", {
    rows: labelRows(items, source, fields, resolved.prefixes), layout: "two-up", template: resolved.template,
    ...(resolved.style ? { style: resolved.style } : {}),
  });
  return ok({ ...result, source, template: resolved.template, template_id: resolved.templateId, template_label: resolved.label, fields, count: items.length });
});
