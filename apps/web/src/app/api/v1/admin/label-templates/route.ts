import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, HttpError, ok, readJson } from "@/lib/http";
import { listTemplates, parseTemplateDraft, type LabelTemplate } from "@/lib/label-templates";

export const GET = handle(async () => { await requireUser("admin"); return ok({ templates: await listTemplates(query) }); });

export const POST = handle(async (req: Request) => {
  const admin = await requireUser("admin");
  const t = parseTemplateDraft(await readJson(req));
  try {
    const [template] = await query<LabelTemplate>(
      `INSERT INTO label_templates(source, name, base_template, name_pt, detail_pt, line_gap, fields, created_by, name_align, detail_align)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, source, name, base_template, name_pt, detail_pt, line_gap, name_align, detail_align, fields, updated_at`,
      [t.source, t.name, t.base_template, t.name_pt, t.detail_pt, t.line_gap, JSON.stringify(t.fields), admin.id, t.name_align, t.detail_align],
    );
    await audit(admin.id, "admin.label_template_create", "label_template", template.id, { ...t }, req);
    return ok({ template }, 201);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "同一来源下已有同名模板");
    throw e;
  }
});
