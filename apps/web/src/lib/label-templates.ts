import { HttpError, str } from "./http";
import type { MaterialQuery } from "./materials-list";
import { parseSource, parseTemplate, sourceDef, TEMPLATES, type SourceKey, type TemplateKey } from "./label-sources";

// 自定义标签模板（TASK-90）：管理员复制内置模板后调字号、行距、字段顺序与前缀。
// 渲染仍由标签服务按「内置模板 + style」完成；字段顺序与前缀在工作台拼行时生效。

export type TemplateField = { key: string; prefix: string };
export type LabelTemplate = {
  id: number; source: SourceKey; name: string; base_template: TemplateKey;
  name_pt: number; detail_pt: number; line_gap: number; fields: TemplateField[]; updated_at?: string;
};
export type TemplateDraft = Omit<LabelTemplate, "id" | "updated_at">;

// 与标签服务 render.STYLE_LIMITS、迁移 016 的 CHECK 保持一致
export const STYLE_LIMITS = { name_pt: [12, 72], detail_pt: [10, 48], line_gap: [0, 20] } as const;

// 内置模板的默认字号与行距（与 apps/labelprint/labelprint/render.py 的 TEMPLATES 一致），
// 「复制内置模板」时用来预填表单。
export const BUILTIN_STYLES: Record<TemplateKey, { name_pt: number; detail_pt: number; line_gap: number }> = {
  "name-detail": { name_pt: 34, detail_pt: 20, line_gap: 2 },
  uniform: { name_pt: 22, detail_pt: 22, line_gap: 2 },
  "name-only": { name_pt: 46, detail_pt: 20, line_gap: 2 },
};

const COLUMNS = "id, source, name, base_template, name_pt, detail_pt, line_gap, fields, updated_at";

function intIn(value: unknown, [low, high]: readonly [number, number], label: string) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < low || n > high) throw new HttpError(400, `${label}必须是 ${low} 到 ${high} 的整数`);
  return n;
}

export function parseTemplateDraft(body: Record<string, unknown>): TemplateDraft {
  const source = parseSource(body.source);
  const name = str(body.name);
  if (!name || name.length > 40) throw new HttpError(400, "模板名称不能为空且不超过 40 字");
  const def = sourceDef(source);
  if (!Array.isArray(body.fields)) throw new HttpError(400, "请至少选择一个字段");
  const seen = new Set<string>();
  const fields: TemplateField[] = [];
  for (const raw of body.fields as unknown[]) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const key = str(item.key);
    if (!def.fields.some((f) => f.key === key) || seen.has(key)) continue;
    const prefix = String(item.prefix ?? "");
    if (prefix.length > 20) throw new HttpError(400, "字段前缀不超过 20 字");
    seen.add(key);
    fields.push({ key, prefix });
  }
  if (!fields.length) throw new HttpError(400, "请至少选择一个有效字段");
  return {
    source, name, fields,
    base_template: parseTemplate(body.base_template),
    name_pt: intIn(body.name_pt, STYLE_LIMITS.name_pt, "名称字号"),
    detail_pt: intIn(body.detail_pt, STYLE_LIMITS.detail_pt, "字段字号"),
    line_gap: intIn(body.line_gap, STYLE_LIMITS.line_gap, "行距"),
  };
}

export async function listTemplates(db: MaterialQuery, source?: SourceKey) {
  return source
    ? db<LabelTemplate>(`SELECT ${COLUMNS} FROM label_templates WHERE NOT is_deleted AND source=$1 ORDER BY name, id`, [source])
    : db<LabelTemplate>(`SELECT ${COLUMNS} FROM label_templates WHERE NOT is_deleted ORDER BY source, name, id`);
}

export async function getTemplate(db: MaterialQuery, id: number) {
  const [row] = await db<LabelTemplate>(`SELECT ${COLUMNS} FROM label_templates WHERE id=$1 AND NOT is_deleted`, [id]);
  if (!row) throw new HttpError(404, "模板不存在或已删除，请刷新后重试");
  return row;
}

export function parseTemplateId(value: unknown) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "模板编号无效");
  return id;
}

// 预览/打印时选用的模板：内置模板沿用请求里的字段；自定义模板用模板自己的字段顺序与前缀。
export type ResolvedTemplate = {
  template: TemplateKey; templateId: number | null; label: string;
  style?: { name_pt: number; detail_pt: number; line_gap: number };
  fields?: string[]; prefixes?: Record<string, string>;
};

export function resolveDraft(t: TemplateDraft, templateId: number | null = null): ResolvedTemplate {
  return {
    template: t.base_template, templateId, label: t.name,
    style: { name_pt: t.name_pt, detail_pt: t.detail_pt, line_gap: t.line_gap },
    fields: t.fields.map((f) => f.key),
    prefixes: Object.fromEntries(t.fields.map((f) => [f.key, f.prefix])),
  };
}

export async function resolveTemplate(db: MaterialQuery, source: SourceKey, body: Record<string, unknown>): Promise<ResolvedTemplate> {
  if (body.template_id !== undefined && body.template_id !== null && body.template_id !== "") {
    const t = await getTemplate(db, parseTemplateId(body.template_id));
    if (t.source !== source) throw new HttpError(400, "该模板不适用于当前打印来源");
    return resolveDraft(t, t.id);
  }
  const template = parseTemplate(body.template);
  return { template, templateId: null, label: TEMPLATES.find((t) => t.key === template)?.label ?? template };
}
