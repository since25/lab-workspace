"use client";

import { useEffect, useState } from "react";
import { api, errText } from "@/lib/client";
import { ALIGNS, BUILTIN_STYLES, STYLE_LIMITS as LIMITS, type Align } from "@/lib/label-styles";

// 标签模板编辑（TASK-90）：复制内置模板 → 调字号、行距、字段顺序与前缀 → 预览 → 保存。
type SourceKey = "materials" | "freezer" | "assets" | "custom";
type BaseKey = "name-detail" | "uniform" | "name-only";
type Field = { key: string; label: string };
type Item = Record<string, string | number | boolean> & { id: number };
type TemplateField = { key: string; prefix: string };
type Template = { id: number; source: SourceKey; name: string; base_template: BaseKey; name_pt: number; detail_pt: number; line_gap: number; name_align: Align; detail_align: Align; fields: TemplateField[] };
type Row = Field & { on: boolean; prefix: string };
type Media = { width_mm: number; height_mm: number; slot_width_mm: number; slot_height_mm: number };
type Preview = { images: string[]; count: number; media?: Media };

const SOURCES: { key: SourceKey; label: string }[] = [
  { key: "materials", label: "部门物料" },
  { key: "freezer", label: "冰箱样品" },
  { key: "assets", label: "固定资产" },
  { key: "custom", label: "自定义 CSV" },
];

// 与标签服务内置模板一致的默认值（apps/labelprint/labelprint/render.py TEMPLATES）
const BUILTINS: { key: BaseKey; label: string; name_pt: number; detail_pt: number; line_gap: number; hint: string }[] = [
  { key: "name-detail", label: "名称 + 字段", name_pt: 34, detail_pt: 20, line_gap: 2, hint: "名称大字，其余逐行" },
  { key: "uniform", label: "等宽全字段", name_pt: 22, detail_pt: 22, line_gap: 2, hint: "字号一致，更紧凑" },
  { key: "name-only", label: "仅名称", name_pt: 46, detail_pt: 20, line_gap: 2, hint: "只打第一个字段" },
];

const DEFAULT_FIELDS: Record<SourceKey, string[]> = {
  materials: ["item_name", "spec_model"],
  freezer: ["name", "project_no", "sample_type"],
  assets: ["asset_name", "asset_code", "spec_model"],
  custom: [],
};

const ALIGN_LABELS: Record<Align, string> = { left: "左对齐", center: "居中", right: "右对齐" };
const FALLBACK_MEDIA: Media = { width_mm: 59.5, height_mm: 15.1, slot_width_mm: 29.7, slot_height_mm: 15.1 };

type Form = { id: number | null; source: SourceKey; name: string; base_template: BaseKey; name_pt: number; detail_pt: number; line_gap: number; name_align: Align; detail_align: Align };

// 选中字段排前面（按模板顺序），未选字段排后面，保持来源声明顺序
function rowsFor(fields: Field[], chosen: TemplateField[]): Row[] {
  const picked = chosen.map((c) => fields.find((f) => f.key === c.key) && { ...fields.find((f) => f.key === c.key)!, on: true, prefix: c.prefix }).filter(Boolean) as Row[];
  const rest = fields.filter((f) => !chosen.some((c) => c.key === f.key)).map((f) => ({ ...f, on: false, prefix: `${f.label}：` }));
  return [...picked, ...rest];
}

export default function LabelTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [fieldsBySource, setFieldsBySource] = useState<Partial<Record<SourceKey, Field[]>>>({});
  const [form, setForm] = useState<Form | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [copySource, setCopySource] = useState<SourceKey>("materials");
  const [q, setQ] = useState("");
  const [samples, setSamples] = useState<Item[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [media, setMedia] = useState<Media>(FALLBACK_MEDIA);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = () => api<{ templates: Template[] }>("/api/v1/admin/label-templates").then((d) => setTemplates(d.templates), (e) => setError(errText(e)));
  useEffect(() => { void load(); api<Media>("/api/v1/label-print/media").then(setMedia, () => {}); }, []);

  // 取来源的字段与样本记录（预览用前 4 条，可按关键字换一批）
  async function loadSource(source: SourceKey, keyword = "") {
    const data = await api<{ items: Item[]; fields: Field[] }>(`/api/v1/label-print/items?source=${source}&q=${encodeURIComponent(keyword)}&page=1&page_size=4`);
    setFieldsBySource((old) => ({ ...old, [source]: data.fields }));
    setSamples(data.items);
    return data.fields;
  }

  async function open(next: Form, chosen: TemplateField[] | null) {
    setError(""); setNotice(""); setPreview(null); setQ("");
    try {
      const fields = await loadSource(next.source);
      const picked = chosen ?? (next.source === "custom" ? fields.slice(0, 3).map((f) => f.key) : DEFAULT_FIELDS[next.source]).map((key, i) => ({ key, prefix: i === 0 ? "" : `${fields.find((f) => f.key === key)?.label ?? key}：` }));
      setRows(rowsFor(next.source === "custom" ? [...fields, ...picked.filter((f) => !fields.some((x) => x.key === f.key)).map((f) => ({ key: f.key, label: f.key }))] : fields, picked));
      setForm(next);
    } catch (e) { setError(errText(e)); }
  }

  function copyBuiltin(b: typeof BUILTINS[number]) {
    void open({ id: null, source: copySource, name: `${b.label}（自定义）`, base_template: b.key, ...BUILTIN_STYLES[b.key] }, null);
  }

  function copyCustom(t: Template, asNew: boolean) {
    void open({ id: asNew ? null : t.id, source: t.source, name: asNew ? `${t.name} 副本` : t.name, base_template: t.base_template, name_pt: t.name_pt, detail_pt: t.detail_pt, line_gap: t.line_gap, name_align: t.name_align, detail_align: t.detail_align }, t.fields);
  }

  const chosen = rows.filter((r) => r.on);
  const draft = form && { name: form.name, base_template: form.base_template, name_pt: form.name_pt, detail_pt: form.detail_pt, line_gap: form.line_gap, name_align: form.name_align, detail_align: form.detail_align, fields: chosen.map((r, i) => ({ key: r.key, prefix: i === 0 ? "" : r.prefix })) };

  function change(patch: Partial<Form>) { setForm((old) => old && { ...old, ...patch }); setPreview(null); }
  function changeRow(key: string, patch: Partial<Row>) { setRows((old) => old.map((r) => r.key === key ? { ...r, ...patch } : r)); setPreview(null); }
  function move(index: number, delta: number) {
    setRows((old) => {
      const next = [...old];
      const target = index + delta;
      if (target < 0 || target >= next.length) return old;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setPreview(null);
  }

  async function makePreview() {
    if (!form || !draft) return;
    setError(""); setNotice("");
    if (!chosen.length) return setError("请至少勾选一个字段");
    if (!samples.length) return setError("当前来源没有可用于预览的记录，换个关键字试试");
    setBusy(true);
    try {
      setPreview(await api<Preview>("/api/v1/label-print/preview", { method: "POST", body: JSON.stringify({ source: form.source, ids: samples.map((s) => s.id), draft }) }));
    } catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!form || !draft) return;
    setError(""); setNotice("");
    setBusy(true);
    try {
      const body = JSON.stringify({ ...draft, source: form.source });
      if (form.id) await api(`/api/v1/admin/label-templates/${form.id}`, { method: "PATCH", body });
      else await api("/api/v1/admin/label-templates", { method: "POST", body });
      setNotice(`已保存模板「${form.name}」，打印页选「${SOURCES.find((s) => s.key === form.source)?.label}」即可选用`);
      setForm(null); setPreview(null);
      await load();
    } catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  }

  async function remove(t: Template) {
    if (!window.confirm(`删除模板「${t.name}」？删除后打印页不再显示，历史打印记录不受影响。`)) return;
    setError(""); setNotice("");
    try { await api(`/api/v1/admin/label-templates/${t.id}`, { method: "DELETE" }); if (form?.id === t.id) setForm(null); await load(); }
    catch (e) { setError(errText(e)); }
  }

  const baseLabel = (key: BaseKey) => BUILTINS.find((b) => b.key === key)?.label ?? key;
  const sourceLabel = (key: SourceKey) => SOURCES.find((s) => s.key === key)?.label ?? key;
  const fieldLabel = (source: SourceKey, key: string) => fieldsBySource[source]?.find((f) => f.key === key)?.label ?? key;
  const nameOnly = form?.base_template === "name-only";

  const num = (key: "name_pt" | "detail_pt" | "line_gap", label: string, unit: string, disabled = false) => form && (
    <label className="field">{label}（{LIMITS[key][0]}–{LIMITS[key][1]} {unit}）
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="range" aria-label={`${label}滑块`} min={LIMITS[key][0]} max={LIMITS[key][1]} value={form[key]} disabled={disabled} onChange={(e) => change({ [key]: Number(e.target.value) })} />
        <input type="number" aria-label={label} style={{ width: 72 }} min={LIMITS[key][0]} max={LIMITS[key][1]} value={form[key]} disabled={disabled} onChange={(e) => change({ [key]: Number(e.target.value) })} />
      </span>
    </label>
  );

  return <>
    <h1>标签模板</h1>
    <p className="muted">复制内置模板后调整名称字号、字段字号、行距、字段顺序与前缀，预览满意再保存。自定义模板绑定一个打印来源，所有能打印的人都可在「标签打印」页选用。字号单位为点（300 dpi，约 0.085 mm），超宽时仍会自动缩小。</p>

    <section className="panel">
      <h2>内置模板</h2>
      <div className="toolbar">
        <label className="field">复制到来源
          <select value={copySource} onChange={(e) => setCopySource(e.target.value as SourceKey)}>
            {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>
      <div className="table-wrap"><table><thead><tr><th>模板</th><th>名称字号</th><th>字段字号</th><th>行距</th><th>说明</th><th></th></tr></thead><tbody>
        {BUILTINS.map((b) => <tr key={b.key}><td>{b.label}<span className="flag">内置</span></td><td>{b.name_pt}</td><td>{b.key === "name-only" ? "不排字段" : b.detail_pt}</td><td>{b.line_gap}</td><td className="muted">{b.hint}</td>
          <td className="actions"><button className="link" onClick={() => copyBuiltin(b)}>复制并编辑</button></td></tr>)}
      </tbody></table></div>
    </section>

    <section className="panel">
      <h2>自定义模板</h2>
      <div className="table-wrap"><table><thead><tr><th>来源</th><th>名称</th><th>基于</th><th>名称字号</th><th>字段字号</th><th>行距</th><th>对齐（名称 / 字段）</th><th>字段顺序与前缀</th><th></th></tr></thead><tbody>
        {templates.map((t) => <tr key={t.id}><td>{sourceLabel(t.source)}</td><td>{t.name}</td><td>{baseLabel(t.base_template)}</td><td>{t.name_pt}</td><td>{t.detail_pt}</td><td>{t.line_gap}</td><td>{ALIGN_LABELS[t.name_align]} / {t.base_template === "name-only" ? "不排字段" : ALIGN_LABELS[t.detail_align]}</td>
          <td className="text-col">{t.fields.map((f, i) => i === 0 ? `【标题】${fieldLabel(t.source, f.key)}` : `${f.prefix || "（无前缀）"}${fieldLabel(t.source, f.key)}`).join(" → ")}</td>
          <td className="actions"><button className="link" onClick={() => copyCustom(t, false)}>编辑</button><button className="link" onClick={() => copyCustom(t, true)}>复制</button><button className="link" onClick={() => void remove(t)}>删除</button></td></tr>)}
        {!templates.length && <tr><td colSpan={9} className="muted">还没有自定义模板，从上方内置模板「复制并编辑」开始</td></tr>}
      </tbody></table></div>
    </section>

    {error && !form && <div className="error">{error}</div>}
    {notice && <p role="status">{notice}</p>}

    {form && <section className="panel">
      <h2>{form.id ? `编辑模板：${form.name}` : "新建自定义模板"}</h2>
      <div className="form-grid">
        <label className="field">来源<select value={form.source} disabled={!!form.id} onChange={(e) => void open({ ...form, source: e.target.value as SourceKey }, null)}>
          {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select></label>
        <label className="field">模板名称<input value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="field">基于<select value={form.base_template} onChange={(e) => change({ base_template: e.target.value as BaseKey })}>
          {BUILTINS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select></label>
      </div>
      <div className="form-grid">
        {num("name_pt", "名称字号", "点")}
        {num("detail_pt", "字段字号", "点", nameOnly)}
        {num("line_gap", "行距", "点", nameOnly)}
        {(["name_align", "detail_align"] as const).map((key) => <label className="field" key={key}>{key === "name_align" ? "名称对齐" : "字段对齐"}
          <select value={form[key]} disabled={key === "detail_align" && nameOnly} onChange={(e) => change({ [key]: e.target.value as Align })}>
            {ALIGNS.map((align) => <option key={align} value={align}>{ALIGN_LABELS[align]}</option>)}
          </select>
        </label>)}
      </div>
      {nameOnly && <p className="muted">「仅名称」只打印第一个勾选字段，字段字号、行距与字段对齐不生效。</p>}

      {form.source === "custom" && !fieldsBySource.custom?.length && <p className="muted">请先在打印页上传一个批次</p>}

      <h3>字段顺序与前缀</h3>
      <p className="muted">勾选要打印的字段，用上移/下移调整顺序；第一个勾选的字段作为大字标题，不加前缀。前缀原样打印，留空表示只打值。</p>
      <div className="table-wrap"><table><thead><tr><th>打印</th><th>顺序</th><th>字段</th><th>前缀</th><th></th></tr></thead><tbody>
        {rows.map((r, i) => {
          const order = r.on ? chosen.findIndex((c) => c.key === r.key) : -1;
          return <tr key={r.key}>
            <td><input type="checkbox" aria-label={`打印 ${r.label}`} style={{ minHeight: 0 }} checked={r.on} onChange={(e) => changeRow(r.key, { on: e.target.checked })} /></td>
            <td>{order === 0 ? "标题" : order > 0 ? order + 1 : "—"}</td>
            <td>{r.label}</td>
            <td><input aria-label={`${r.label} 前缀`} value={order === 0 ? "" : r.prefix} placeholder={order === 0 ? "标题不加前缀" : "留空则只打值"} disabled={order === 0 || !r.on} maxLength={20} style={{ width: 160 }} onChange={(e) => changeRow(r.key, { prefix: e.target.value })} /></td>
            <td className="actions"><button className="link" aria-label={`上移 ${r.label}`} onClick={() => move(i, -1)} disabled={i === 0}>上移</button><button className="link" aria-label={`下移 ${r.label}`} onClick={() => move(i, 1)} disabled={i === rows.length - 1}>下移</button></td>
          </tr>;
        })}
      </tbody></table></div>

      <div className="toolbar">
        <strong>预览样本</strong>
        <span className="muted">{samples.length ? samples.map((s) => String(s.item_name ?? s.name ?? s.asset_name ?? s.title ?? s.id)).join("、") : "无记录"}</span>
        <label className="field">换一批<input value={q} placeholder="名称 / 编码关键字" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void loadSource(form.source, q).then(() => setPreview(null), (err) => setError(errText(err))); }} /></label>
        <button onClick={() => void loadSource(form.source, q).then(() => setPreview(null), (err) => setError(errText(err)))} disabled={busy}>查找</button>
        <span className="spacer" />
        <button onClick={() => void makePreview()} disabled={busy}>预览</button>
        <button className="primary" onClick={() => void save()} disabled={busy || !form.name.trim() || !chosen.length}>保存模板</button>
        <button className="link" onClick={() => { setForm(null); setPreview(null); setError(""); }}>取消</button>
      </div>
      {error && <div className="error">{error}</div>}

      {preview && <div className="preview-grid">{preview.images.map((image, i) => (
        <figure key={i} className="label-figure">
          <div className="label-frame">
            <span className="label-dim">整张 {(preview.media ?? media).width_mm} × {(preview.media ?? media).height_mm} mm</span>
            <img src={`data:image/png;base64,${image}`} alt={`模板预览第 ${i + 1} 张`} />
            <span className="label-cut" aria-hidden="true" />
            <span className="label-dim slot">单格 {Math.round(media.slot_width_mm)} × {Math.round(media.slot_height_mm)} mm</span>
          </div>
          <figcaption className="muted">第 {i + 1} 张标签纸 · 按实际比例等比显示</figcaption>
        </figure>
      ))}</div>}
    </section>}
  </>;
}
