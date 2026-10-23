"use client";

import { useEffect, useMemo, useState } from "react";
import { api, errText } from "@/lib/client";

type Item = { id: number; item_name: string; material_code: string; brand: string; spec_model: string; unit: string; department: string; requester: string; is_used_up: boolean };
type Field = { key: "item_name" | "material_code" | "spec_model" | "brand"; label: string };
type Printer = { id: number; printer_key: string; name: string; enabled: boolean; is_default: boolean; ready?: boolean; reason?: string; jobs?: number; notes?: string };
type Preview = { images: string[]; count: number; media_count?: number; fields: string[] };

const fallbackFields: Field[] = [
  { key: "item_name", label: "物料名称" },
  { key: "material_code", label: "物料编码" },
  { key: "spec_model", label: "规格型号" },
  { key: "brand", label: "品牌" },
];

export default function LabelPrintPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [fields, setFields] = useState<Field[]>(fallbackFields);
  const [selectedFields, setSelectedFields] = useState<string[]>(["item_name", "material_code", "spec_model"]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [printerId, setPrinterId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"load" | "preview" | "print" | "printer" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const ids = useMemo(() => [...selected], [selected]);
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  const load = async () => {
    setBusy("load");
    try {
      const [materialData, printerData] = await Promise.all([
        api<{ items: Item[]; fields: Field[] }>(`/api/v1/label-print/materials?q=${encodeURIComponent(q)}`),
        api<{ printers: Printer[] }>("/api/v1/label-print/printers"),
      ]);
      setItems(materialData.items);
      setFields(materialData.fields);
      setPrinters(printerData.printers);
      if (!printerId || !printerData.printers.some((p) => String(p.id) === printerId)) {
        setPrinterId(String(printerData.printers.find((p) => p.is_default)?.id ?? printerData.printers[0]?.id ?? ""));
      }
      setError("");
    } catch (e) { setError(errText(e)); }
    finally { setBusy(""); }
  };

  // 初次进入页面加载物料和打印机；搜索由回车/刷新按钮显式触发。
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

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

  async function makePreview() {
    setError(""); setNotice("");
    if (!ids.length) return setError("请先勾选要打印的物料");
    if (!selectedFields.length) return setError("请至少选择一个打印字段");
    setBusy("preview");
    try {
      setPreview(await api<Preview>("/api/v1/label-print/preview", { method: "POST", body: JSON.stringify({ ids, fields: selectedFields, template: "material-v1" }) }));
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
        body: JSON.stringify({ request_id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, ids, fields: selectedFields, template: "material-v1", printer_id: Number(printerId) }),
      });
      setNotice(`${result.message || `已送出 ${result.sent ?? preview.count} 张`}，打印机：${result.printer || "已选设备"}`);
    } catch (e) { setError(errText(e)); }
    finally { setBusy(""); }
  }

  return (
    <>
      <h1>标签打印</h1>
      <p className="muted">从部门物料中选择记录，按一个内置模板批量生成标签。打印服务只接受工作台服务端请求。</p>
      <section className="panel">
        <div className="toolbar">
          <label className="field">搜索物料<input value={q} placeholder="名称 / 货号 / 规格型号" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void load(); }} /></label>
          <button onClick={() => void load()} disabled={busy !== ""}>刷新物料</button>
          <span className="muted">当前显示 {items.length} 条，最多 500 条</span>
        </div>
        <div className="toolbar">
          <strong>打印字段</strong>
          {fields.map((field) => <label key={field.key} style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" style={{ minHeight: 0 }} checked={selectedFields.includes(field.key)} onChange={() => toggleField(field.key)} />{field.label}</label>)}
          <span className="muted">模板：物料标签（内置）</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th><input type="checkbox" aria-label="全选当前物料" style={{ minHeight: 0 }} checked={allSelected} onChange={toggleAll} /></th><th>名称</th><th>物料编码</th><th>品牌</th><th>规格型号</th><th>部门</th></tr></thead>
            <tbody>
              {items.map((item) => <tr key={item.id}>
                <td><input type="checkbox" aria-label={`选择 ${item.item_name}`} style={{ minHeight: 0 }} checked={selected.has(item.id)} onChange={() => toggleItem(item.id)} /></td>
                <td className="text-col">{item.item_name || "（无名称）"}</td><td className="mono">{item.material_code}</td><td>{item.brand}</td><td className="mono">{item.spec_model}</td><td>{item.department}</td>
              </tr>)}
              {!items.length && <tr><td colSpan={6} className="muted">没有符合条件的可打印物料</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <label className="field">打印机
            <select value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
              <option value="">请选择打印机</option>
              {printers.map((printer) => <option key={printer.id} value={printer.id} disabled={!printer.enabled || printer.ready === false}>{printer.name}{printer.ready === false ? `（不可用：${printer.reason || "状态未知"}）` : ""}</option>)}
            </select>
          </label>
          <div className="muted">{printers.map((printer) => <span key={printer.id} style={{ marginRight: 14 }}>{printer.name}：{printer.ready === false ? `未就绪${printer.reason ? `（${printer.reason}）` : ""}` : "就绪"}{printer.jobs ? `，队列 ${printer.jobs}` : ""}</span>)}</div>
          <span className="spacer" />
          <button className="primary" onClick={() => void makePreview()} disabled={busy !== ""}>预览（已选 {ids.length} 条）</button>
        </div>
        {error && <div className="error">{error}</div>}
        {notice && <p role="status">{notice}</p>}
      </section>
      {preview && <section className="panel">
        <h2>预览</h2>
        <p className="muted">共 {preview.count} 个标签，{preview.media_count ?? preview.images.length} 张标签纸；字段：{preview.fields.map((key) => fields.find((f) => f.key === key)?.label ?? key).join("、")}</p>
        <div className="preview-grid">{preview.images.map((image, i) => <figure key={i} style={{ margin: 0 }}><img src={`data:image/png;base64,${image}`} alt={`第 ${i + 1} 张标签纸预览`} style={{ maxWidth: 480 }} /><figcaption>第 {i + 1} 张标签纸</figcaption></figure>)}</div>
        <button className="primary" onClick={() => void print()} disabled={busy !== "" || !printerId}>确认打印</button>
      </section>}
    </>
  );
}
