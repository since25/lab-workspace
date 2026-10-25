import { HttpError, str } from "./http";
import type { MaterialQuery } from "./materials-list";
import { parseSource, parseTemplate, sourceDef, TEMPLATES, type SourceKey, type TemplateKey } from "./label-sources";
import { ALIGNS, BUILTIN_STYLES, STYLE_LIMITS, type Align, type LabelStyle } from "./label-styles";
export { ALIGNS, BUILTIN_STYLES, STYLE_LIMITS, type Align, type LabelStyle } from "./label-styles";

// 自定义标签模板（TASK-90）：管理员复制内置模板后调字号、行距、字段顺序与前缀。
// 渲染仍由标签服务按「内置模板 + style」完成；字段顺序与前缀在工作台拼行时生效。

export type TemplateField = { key: string; prefix: string };
export type LabelTemplate = {
  id: number; source: SourceKey; name: string; base_template: TemplateKey;
  name_pt: number; detail_pt: number; line_gap: number; name_align: Align; detail_align: Align; fields: TemplateField[]; updated_at?: string;
};
export type TemplateDraft = Omit<LabelTemplate, "id" | "updated_at">;

const COLUMNS = "id, source, name, base_template, name_pt, detail_pt, line_gap, name_align, detail_align, fields, updated_at";

function intIn(value: unknown, [low, high]: readonly [number, number], label: string) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < low || n > high) throw new HttpError(400, `${label}必须是 ${low} 到 ${high} 的整数`);
  return n;
}

function parseAlign(value: unknown, label: string): Align {
  if (!ALIGNS.includes(value as Align)) throw new HttpError(400, `${label}必须是 left、center 或 right`);
  return value as Align;
}

export function parseStyleOverride(value: unknown, base: LabelStyle): LabelStyle | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "微调样式必须是对象");
  const body = value as Record<string, unknown>;
  const style = { ...base };
  for (const [key, label] of [["name_pt", "名称字号"], ["detail_pt", "字段字号"], ["line_gap", "行距"]] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "number") throw new HttpError(400, `${label}必须是整数`);
      style[key] = intIn(body[key], STYLE_LIMITS[key], label);
    }
  }
  for (const [key, label] of [["name_align", "名称对齐"], ["detail_align", "字段对齐"]] as const) {
    if (body[key] !== undefined) style[key] = parseAlign(body[key], label);
  }
  return style;
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
    const key = source === "custom" && typeof item.key !== "string" ? "" : str(item.key);
    if (source === "custom" && key.length > 60) throw new HttpError(400, "字段名称不超过 60 字");
    if (!key || (source !== "custom" && !def.fields.some((f) => f.key === key)) || seen.has(key)) continue;
    const prefix = String(item.prefix ?? "");
    if (prefix.length > 20) throw new HttpError(400, "字段前缀不超过 20 字");
    seen.add(key);
    fields.push({ key, prefix });
  }
  if (source === "custom" && fields.length > 30) throw new HttpError(400, "最多选择 30 个字段");
  if (!fields.length) throw new HttpError(400, "请至少选择一个有效字段");
  return {
    source, name, fields,
    base_template: parseTemplate(body.base_template),
    name_pt: intIn(body.name_pt, STYLE_LIMITS.name_pt, "名称字号"),
    detail_pt: intIn(body.detail_pt, STYLE_LIMITS.detail_pt, "字段字号"),
    line_gap: intIn(body.line_gap, STYLE_LIMITS.line_gap, "行距"),
    name_align: parseAlign(body.name_align === undefined ? "left" : body.name_align, "名称对齐"),
    detail_align: parseAlign(body.detail_align === undefined ? "left" : body.detail_align, "字段对齐"),
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
  style?: LabelStyle;
  fields?: string[]; prefixes?: Record<string, string>;
};

export function resolveDraft(t: TemplateDraft, templateId: number | null = null): ResolvedTemplate {
  return {
    template: t.base_template, templateId, label: t.name,
    style: { name_pt: t.name_pt, detail_pt: t.detail_pt, line_gap: t.line_gap, name_align: t.name_align, detail_align: t.detail_align },
    fields: t.fields.map((f) => f.key),
    prefixes: Object.fromEntries(t.fields.map((f) => [f.key, f.prefix])),
  };
}

export async function resolveTemplate(db: MaterialQuery, source: SourceKey, body: Record<string, unknown>): Promise<ResolvedTemplate> {
  if (body.template_id !== undefined && body.template_id !== null && body.template_id !== "") {
    const t = await getTemplate(db, parseTemplateId(body.template_id));
    if (t.source !== source) throw new HttpError(400, "该模板不适用于当前打印来源");
    const resolved = resolveDraft(t, t.id);
    resolved.style = parseStyleOverride(body.style_override, resolved.style!) ?? resolved.style;
    return resolved;
  }
  const template = parseTemplate(body.template);
  const style = parseStyleOverride(body.style_override, BUILTIN_STYLES[template]);
  return { template, templateId: null, label: TEMPLATES.find((t) => t.key === template)?.label ?? template, ...(style ? { style } : {}) };
}
