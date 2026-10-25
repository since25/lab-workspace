import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, HttpError, ok, readJson } from "@/lib/http";
import { getTemplate, parseTemplateDraft, parseTemplateId, type LabelTemplate } from "@/lib/label-templates";

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/v1/admin/label-templates/[id]">) => {
  const admin = await requireUser("admin");
  const id = parseTemplateId((await ctx.params).id);
  const old = await getTemplate(query, id);
  const t = parseTemplateDraft(await readJson(req));
  if (t.source !== old.source) throw new HttpError(400, "模板的来源不能修改，请另建模板");
  try {
    const [template] = await query<LabelTemplate>(
      `UPDATE label_templates SET name=$2, base_template=$3, name_pt=$4, detail_pt=$5, line_gap=$6, fields=$7, name_align=$8, detail_align=$9, updated_at=now()
        WHERE id=$1 AND NOT is_deleted
        RETURNING id, source, name, base_template, name_pt, detail_pt, line_gap, name_align, detail_align, fields, updated_at`,
      [id, t.name, t.base_template, t.name_pt, t.detail_pt, t.line_gap, JSON.stringify(t.fields), t.name_align, t.detail_align],
    );
    await audit(admin.id, "admin.label_template_update", "label_template", id, { ...t }, req);
    return ok({ template });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "同一来源下已有同名模板");
    throw e;
  }
});

// 删除只隐藏：历史打印记录的 template_id 仍指向它
export const DELETE = handle(async (req: Request, ctx: RouteContext<"/api/v1/admin/label-templates/[id]">) => {
  const admin = await requireUser("admin");
  const id = parseTemplateId((await ctx.params).id);
  const old = await getTemplate(query, id);
  await query("UPDATE label_templates SET is_deleted=true, updated_at=now() WHERE id=$1", [id]);
  await audit(admin.id, "admin.label_template_delete", "label_template", id, { name: old.name, source: old.source }, req);
  return ok({ ok: true });
});
