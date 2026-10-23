"use client";

import { useEffect, useMemo, useState } from "react";
import { api, errText } from "@/lib/client";

type SourceKey = "materials" | "freezer" | "assets";
type Item = Record<string, string | number | boolean> & { id: number };
type Field = { key: string; label: string };
type Printer = { id: number; printer_key: string; name: string; enabled: boolean; is_default: boolean; ready?: boolean; reason?: string; jobs?: number; notes?: string };
type Preview = { images: string[]; count: number; media_count?: number; fields: string[]; template?: string };

const SOURCES: { key: SourceKey; label: string; hint: string }[] = [
  { key: "materials", label: "部门物料", hint: "采购入库的物料与试剂" },
  { key: "freezer", label: "冰箱样品", hint: "在库样品、项目号与位置" },
  { key: "assets", label: "固定资产", hint: "设备与台账资产" },
];

const TEMPLATES: { key: string; label: string; hint: string }[] = [
  { key: "name-detail", label: "名称 + 字段", hint: "名称大字，其余逐行" },
  { key: "uniform", label: "等宽全字段", hint: "字号一致，更紧凑" },
  { key: "name-only", label: "仅名称", hint: "超大名称，货架/抽屉" },
];

const DEFAULT_FIELDS: Record<SourceKey, string[]> = {
  materials: ["item_name", "spec_model"],
  freezer: ["name", "project_no", "sample_type"],
  assets: ["asset_name", "asset_code", "spec_model"],
};

export default function LabelPrintPage() {
  const [source, setSource] = useState<SourceKey>("materials");
  const [items, setItems] = useState<Item[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [columns, setColumns] = useState<Field[]>([]);
  const [selectedFields, setSelectedFields] = useState<string[]>(DEFAULT_FIELDS.materials);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [printerId, setPrinterId] = useState("");
  const [template, setTemplate] = useState("name-detail");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"load" | "preview" | "print" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [copies, setCopies] = useState(1);

  const ids = useMemo(() => [...selected], [selected]);
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const sheets = Math.ceil(ids.length / 2) * copies;

  const load = async (nextSource = source, nextPage = page, nextSize = pageSize) => {
    setBusy("load");
    try {
      const [itemData, printerData] = await Promise.all([
        api<{ items: Item[]; total: number; page: number; page_size: number; fields: Field[]; columns: Field[] }>(
          `/api/v1/label-print/items?source=${nextSource}&q=${encodeURIComponent(q)}&page=${nextPage}&page_size=${nextSize}`),
        api<{ printers: Printer[] }>("/api/v1/label-print/printers"),
      ]);
      setItems(itemData.items);
      setFields(itemData.fields);
      setColumns(itemData.columns);
      setTotal(itemData.total);
      setPage(itemData.page);
      setPageSize(itemData.page_size);
      setPrinters(printerData.printers);
      if (!printerId || !printerData.printers.some((p) => String(p.id) === printerId)) {
        setPrinterId(String(printerData.printers.find((p) => p.is_default)?.id ?? printerData.printers[0]?.id ?? ""));
      }
      setError("");
    } catch (e) { setError(errText(e)); }
    finally { setBusy(""); }
  };

  // 初次进入页面加载；来源切换、搜索、翻页由交互显式触发。
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load("materials", 1, 20); }, []);

  function switchSource(next: SourceKey) {
    setSource(next);
    setSelected(new Set());
    setPreview(null);
    setSelectedFields(DEFAULT_FIELDS[next]);
    setQ("");
    void load(next, 1, pageSize);
  }

  function toggleField(key: string) {
    setSelectedFields((old) => old.includes(key) ? old.filter((v) => v !== key) : [...old, key]);
    setPreview(null);
  }

  function toggleItem(id: number) {
    setSelected((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    setPreview(null);
  }

  function toggleAll() {
    setSelected((old) => {
      const next = new Set(old);
      if (allSelected) items.forEach((item) => next.delete(item.id)); else items.forEach((item) => next.add(item.id));
      return next;
    });
    setPreview(null);
  }

  function switchTemplate(key: string) {
    setTemplate(key);
    setPreview(null);
  }

  async function makePreview() {
    setError(""); setNotice("");
    if (!ids.length) return setError("请先勾选要打印的记录");
    if (!selectedFields.length) return setError("请至少选择一个打印字段");
    setBusy("preview");
    try {
      setPreview(await api<Preview>("/api/v1/label-print/preview", {
        method: "POST",
        body: JSON.stringify({ source, ids, fields: selectedFields, template }),
      }));
    } catch (e) { setError(errText(e)); }
    finally { setBusy(""); }
  }

  async function print() {
    setError(""); setNotice("");
    if (!preview) return setError("请先预览，预览确认后才能打印");
    if (!printerId) return setError("请先选择打印机");
    setBusy("print");
    try {
      const result = await api<{ message?: string; sent?: number; printer?: string }>("/api/v1/label-print/print", {
        method: "POST",
        body: JSON.stringify({
          request_id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          source, ids, fields: selectedFields, template, printer_id: Number(printerId), copies,
        }),
      });
      setNotice(`${result.message || `已送出 ${result.sent ?? preview.count} 张`}，打印机：${result.printer || "已选设备"}`);
    } catch (e) { setError(errText(e)); }
    finally { setBusy(""); }
  }

  const value = (item: Item, key: string) => String(item[key] ?? "") || "—";

  return (
    <>
      <h1>标签打印</h1>
      <p className="muted">选择来源与记录，挑模板和字段，预览后提交到本机标签服务。浏览器不直接访问打印服务端口。</p>

      <section className="panel">
        <div className="toolbar">
          {SOURCES.map((s) => (
            <button key={s.key} className={s.key === source ? "primary" : ""} title={s.hint} onClick={() => switchSource(s.key)} disabled={busy !== ""}>
              {s.label}
            </button>
          ))}
          <span className="spacer" />
          <span className="muted">共 {total} 条 · 第 {page} / {pages} 页</span>
          <label className="field">搜索
            <input value={q} placeholder="名称 / 编码 / 规格" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void load(source, 1, pageSize); }} />
          </label>
          <button onClick={() => void load(source, 1, pageSize)} disabled={busy !== ""}>搜索</button>
          <label className="field">每页
            <select value={pageSize} onChange={(e) => { const size = Number(e.target.value); setPageSize(size); void load(source, 1, size); }}>
              {[20, 50, 100].map((size) => <option key={size} value={size}>{size} 条</option>)}
            </select>
          </label>
          <button onClick={() => void load(source, page - 1, pageSize)} disabled={busy !== "" || page <= 1}>上一页</button>
          <button onClick={() => void load(source, page + 1, pageSize)} disabled={busy !== "" || page >= pages}>下一页</button>
        </div>
      </section>

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="全选当前页" style={{ minHeight: 0 }} checked={allSelected} onChange={toggleAll} /></th>
                {columns.map((c) => <th key={c.key}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><input type="checkbox" aria-label={`选择 ${String(item[columns[0]?.key] ?? item.id)}`} style={{ minHeight: 0 }} checked={selected.has(item.id)} onChange={() => toggleItem(item.id)} /></td>
                  {columns.map((c) => <td key={c.key} className={c.key.includes("code") ? "mono text-col" : "text-col"}>{value(item, c.key)}</td>)}
                </tr>
              ))}
              {!items.length && <tr><td colSpan={columns.length + 1} className="muted">没有符合条件的可打印记录</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <strong>模板</strong>
          {TEMPLATES.map((t) => (
            <label key={t.key} style={{ display: "flex", gap: 6, alignItems: "center", marginRight: 12 }}>
              <input type="radio" name="template" style={{ minHeight: 0 }} checked={template === t.key} onChange={() => switchTemplate(t.key)} />
              {t.label}<span className="muted">{t.hint}</span>
            </label>
          ))}
        </div>
        <div className="toolbar">
          <strong>打印字段</strong>
          {fields.map((field) => (
            <label key={field.key} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" style={{ minHeight: 0 }} checked={selectedFields.includes(field.key)} onChange={() => toggleField(field.key)} />
              {field.label}
            </label>
          ))}
          <span className="muted">{template === "name-only" ? "仅名称模板只打印第一个选中字段" : "第一个选中字段作为大字标题，其余逐行"}</span>
        </div>
      </section>

      <section className="panel" style={{ position: "sticky", bottom: 0, zIndex: 2 }}>
        <div className="toolbar">
          <span>已选 <strong>{ids.length}</strong> 条</span>
          <span className="muted">双列纸约 {sheets} 张</span>
          <button className="link" onClick={() => { setSelected(new Set()); setPreview(null); }} disabled={!ids.length}>清空选择</button>
          <span className="spacer" />
          <label className="field">份数
            <input type="number" min={1} max={20} step={1} style={{ width: 80 }} value={copies} onChange={(e) => setCopies(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} />
          </label>
          <label className="field">打印机
            <select value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
              <option value="">请选择打印机</option>
              {printers.map((printer) => <option key={printer.id} value={printer.id} disabled={!printer.enabled || printer.ready === false}>{printer.name}{printer.ready === false ? `（不可用：${printer.reason || "状态未知"}）` : ""}</option>)}
            </select>
          </label>
          <button className="primary" onClick={() => void makePreview()} disabled={busy !== "" || !ids.length}>预览</button>
        </div>
        <div className="muted">{printers.map((printer) => <span key={printer.id} style={{ marginRight: 14 }}>{printer.name}：{printer.ready === false ? `未就绪${printer.reason ? `（${printer.reason}）` : ""}` : "就绪"}{printer.jobs ? `，队列 ${printer.jobs}` : ""}</span>)}</div>
        {error && <div className="error">{error}</div>}
        {notice && <p role="status">{notice}</p>}
      </section>

      {preview && (
        <section className="panel">
          <h2>预览</h2>
          <p className="muted">
            共 {preview.count} 个标签，{preview.media_count ?? preview.images.length} 张标签纸；份数 {copies}；
            模板：{TEMPLATES.find((t) => t.key === (preview.template ?? template))?.label ?? template}；
            字段：{preview.fields.map((key) => fields.find((f) => f.key === key)?.label ?? key).join("、")}
          </p>
          <div className="preview-grid">{preview.images.map((image, i) => <figure key={i} style={{ margin: 0 }}><img src={`data:image/png;base64,${image}`} alt={`第 ${i + 1} 张标签纸预览`} style={{ maxWidth: 480 }} /><figcaption>第 {i + 1} 张标签纸</figcaption></figure>)}</div>
          <button className="primary" onClick={() => void print()} disabled={busy !== "" || !printerId}>确认打印（{copies} 份）</button>
        </section>
      )}
    </>
  );
}
