"use client";

import { useEffect, useMemo, useState } from "react";
import { api, errText } from "@/lib/client";

type SourceKey = "materials" | "freezer" | "assets" | "cells" | "custom";
type Item = Record<string, string | number | boolean> & { id: number };
type Field = { key: string; label: string };
type Printer = { id: number; printer_key: string; name: string; enabled: boolean; is_default: boolean; ready?: boolean; reason?: string; jobs?: number; notes?: string };
type Preview = { images: string[]; count: number; media_count?: number; fields: string[]; template?: string; template_label?: string; media?: Media };
type CustomTemplate = { id: number; name: string; base_template: string; fields: { key: string; prefix: string }[] };
type Media = { dpi: number; width_mm: number; height_mm: number; slot_width_mm: number; slot_height_mm: number; columns: number; command_set?: string };
type CustomBatch = { id: number; batch_name: string; row_count: number; created_at: string };

// 纸张尺寸兜底值：标签服务不可用或还没返回时，仍能显示 30×15 双列的标注。
const FALLBACK_MEDIA: Media = { dpi: 300, width_mm: 59.5, height_mm: 15.1, slot_width_mm: 29.7, slot_height_mm: 15.1, columns: 2, command_set: "tspl" };

const SOURCES: { key: SourceKey; label: string; hint: string }[] = [
  { key: "materials", label: "部门物料", hint: "采购入库的物料与试剂" },
  { key: "freezer", label: "冰箱样品", hint: "在库样品、项目号与位置" },
  { key: "assets", label: "固定资产", hint: "设备与台账资产" },
  { key: "cells", label: "细胞冻存", hint: "冻存管、代次与位置" },
  { key: "custom", label: "自定义 CSV", hint: "上传并固化 CSV 批次数据" },
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
  cells: ["cell_name", "passage", "frozen_on", "location", "depositor"],
  custom: [],
};

// 每次提交一个新编号，服务端据此拦截重复提交
function newRequestId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

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
  // 内置模板用 key；自定义模板用 "custom:<id>"，字段与顺序由模板决定
  const [template, setTemplate] = useState("name-detail");
  const [customs, setCustoms] = useState<CustomTemplate[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"load" | "preview" | "print" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [copies, setCopies] = useState(1);
  const [media, setMedia] = useState<Media>(FALLBACK_MEDIA);
  const [byTubeCount, setByTubeCount] = useState(false);
  const [tubeCountMap, setTubeCountMap] = useState<Record<number, number>>({});
  const [batches, setBatches] = useState<CustomBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editingCell, setEditingCell] = useState<{ id: number; key: string } | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const ids = useMemo(() => [...selected], [selected]);
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const totalLabels = useMemo(() => {
    if (source === "cells" && byTubeCount) {
      return ids.reduce((sum, id) => sum + (tubeCountMap[id] ?? 1), 0);
    }
    return ids.length;
  }, [source, byTubeCount, ids, tubeCountMap]);
  const sheets = Math.ceil(totalLabels / 2) * copies;
  const custom = template.startsWith("custom:") ? customs.find((t) => `custom:${t.id}` === template) : undefined;

  const load = async (nextSource = source, nextPage = page, nextSize = pageSize, nextQ = q, nextBatchId = selectedBatchId) => {
    setBusy("load");
    try {
      const batchParam = nextSource === "custom" && nextBatchId ? `&batch_id=${nextBatchId}` : "";
      const [itemData, printerData, templateData, batchData] = await Promise.all([
        api<{ items: Item[]; total: number; page: number; page_size: number; fields: Field[]; columns: Field[]; batch_id?: number }>(
          `/api/v1/label-print/items?source=${nextSource}&q=${encodeURIComponent(nextQ)}&page=${nextPage}&page_size=${nextSize}${batchParam}`),
        api<{ printers: Printer[] }>("/api/v1/label-print/printers"),
        api<{ templates: CustomTemplate[] }>(`/api/v1/label-print/templates?source=${nextSource}`),
        nextSource === "custom" ? api<{ batches: CustomBatch[] }>("/api/v1/label-print/custom-batches") : Promise.resolve({ batches: [] }),
      ]);
      setCustoms(templateData.templates);
      if (template.startsWith("custom:") && !templateData.templates.some((t) => `custom:${t.id}` === template)) setTemplate("name-detail");
      setItems(itemData.items);
      if (nextSource === "custom") {
        setBatches(batchData.batches);
        if (itemData.batch_id && itemData.batch_id !== selectedBatchId) {
          setSelectedBatchId(itemData.batch_id);
        }
      }
      setTubeCountMap((prev) => {
        const next = { ...prev };
        itemData.items.forEach((item) => {
          const n = Number(item.tube_count);
          next[item.id] = Number.isSafeInteger(n) && n > 0 ? n : 1;
        });
        return next;
      });
      setFields(itemData.fields);
      setColumns(itemData.columns);
      if (nextSource === "custom" && itemData.fields.length > 0) {
        setSelectedFields((old) => old.length ? old : itemData.fields.slice(0, 3).map((f) => f.key));
      }
      setTotal(itemData.total);
      setPage(itemData.page);
      setPageSize(itemData.page_size);
      setPrinters(printerData.printers);
      const curPrinter = (!printerId || !printerData.printers.some((p) => String(p.id) === printerId))
        ? (printerData.printers.find((p) => p.is_default) ?? printerData.printers[0])
        : printerData.printers.find((p) => String(p.id) === printerId);
      if (curPrinter) {
        setPrinterId(String(curPrinter.id));
        api<Media>(`/api/v1/label-print/media?printer_id=${encodeURIComponent(curPrinter.printer_key)}`).then(setMedia, () => {});
      } else {
        api<Media>("/api/v1/label-print/media").then(setMedia, () => {});
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
    setByTubeCount(false);
    setSelectedFields(DEFAULT_FIELDS[next]);
    setTemplate("name-detail");
    setQ("");
    void load(next, 1, pageSize, "", selectedBatchId);
  }

  function handleBatchChange(newBatchId: number) {
    setSelectedBatchId(newBatchId);
    setSelected(new Set());
    setPreview(null);
    setSelectedFields([]);
    void load("custom", 1, pageSize, q, newBatchId);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const text = await file.text();
      const res = await api<{ batch: CustomBatch }>("/api/v1/label-print/custom-batches", {
        method: "POST",
        body: JSON.stringify({ batch_name: file.name, csv_text: text }),
      });
      setNotice(`CSV 批次「${res.batch.batch_name}」上传成功，共 ${res.batch.row_count} 条`);
      setSelectedBatchId(res.batch.id);
      setSelected(new Set());
      setPreview(null);
      setSelectedFields([]);
      void load("custom", 1, pageSize, "", res.batch.id);
    } catch (err) {
      setError(errText(err));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleDeleteBatch() {
    if (!selectedBatchId) return;
    const cur = batches.find((b) => b.id === selectedBatchId);
    const name = cur?.batch_name || "当前批次";
    if (!confirm(`确定要删除批次「${name}」及其全部数据吗？此操作不可恢复。`)) return;
    setBusy("load");
    setError("");
    setNotice("");
    try {
      await api(`/api/v1/label-print/custom-batches?id=${selectedBatchId}`, { method: "DELETE" });
      const remaining = batches.filter((b) => b.id !== selectedBatchId);
      setBatches(remaining);
      setSelected(new Set());
      setPreview(null);
      const nextBatch = remaining[0];
      if (nextBatch) {
        setSelectedBatchId(nextBatch.id);
        await load("custom", 1, pageSize, "", nextBatch.id);
      } else {
        setSelectedBatchId(null);
        setItems([]);
        setFields([]);
        setColumns([]);
        setSelectedFields([]);
        setTotal(0);
      }
      setNotice(`批次「${name}」已成功删除`);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy("");
    }
  }

  async function saveCellEdit(itemId: number, key: string, nextVal: string) {
    setEditingCell(null);
    const target = items.find((it) => it.id === itemId);
    if (!target) return;
    const currentVal = String(target[key] ?? "");
    if (currentVal === nextVal) return;

    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? { ...it, [key]: nextVal, ...(columns[0]?.key === key ? { title: nextVal } : {}) }
          : it
      )
    );
    setPreview(null);

    try {
      await api(`/api/v1/label-print/custom-items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ field: key, value: nextVal }),
      });
      setNotice(`单元格「${key}」已更新为：${nextVal || "（空）"}`);
    } catch (err) {
      setError(`保存单元格修改失败：${errText(err)}`);
      setItems((prev) =>
        prev.map((it) => (it.id === itemId ? { ...it, [key]: target[key] } : it))
      );
    }
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
    const picked = customs.find((t) => `custom:${t.id}` === key);
    if (picked) setSelectedFields(picked.fields.map((f) => f.key));
    setPreview(null);
  }

  // 预览/打印的模板参数：自定义模板只传编号，字段与前缀由服务端按模板取
  function templateBody() {
    return custom ? { template_id: custom.id } : { template };
  }

  async function makePreview() {
    setError(""); setNotice("");
    if (!ids.length) return setError("请先勾选要打印的记录");
    if (!selectedFields.length) return setError("请至少选择一个打印字段");
    setBusy("preview");
    const activePrinter = printers.find((p) => String(p.id) === printerId);
    try {
      setPreview(await api<Preview>("/api/v1/label-print/preview", {
        method: "POST",
        body: JSON.stringify({
          source,
          ids,
          fields: selectedFields,
          by_tube_count: byTubeCount,
          printer_id: activePrinter?.printer_key,
          ...templateBody(),
        }),
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
          request_id: newRequestId(),
          source, ids, fields: selectedFields, by_tube_count: byTubeCount, ...templateBody(), printer_id: Number(printerId), copies,
        }),
      });
      setNotice(`${result.message || `已送出 ${result.sent ?? preview.count} 张`}，打印机：${result.printer || "已选设备"}`);
    } catch (e) { setError(errText(e)); }
    finally { setBusy(""); }
  }

  const value = (item: Item, key: string) => String(item[key] ?? "") || "—";
  const curMedia = preview?.media ?? media;
  const slotSize = `${Math.round(curMedia.slot_width_mm)} × ${Math.round(curMedia.slot_height_mm)}`;
  const cmdSet = (curMedia.command_set || "").toUpperCase();
  const sheetSize = `${curMedia.width_mm} × ${curMedia.height_mm} mm${cmdSet ? ` (${cmdSet})` : ""}`;

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
            <input value={q} placeholder="名称 / 编码 / 代次 / 存放人" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void load(source, 1, pageSize); }} />
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
        {source === "custom" && (
          <div
            className="toolbar"
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 12,
              marginTop: 12,
              alignItems: "center",
              gap: 8,
              marginBottom: 0,
            }}
          >
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: "13px", color: "var(--muted)", whiteSpace: "nowrap" }}>当前 CSV 批次：</span>
              <select
                value={selectedBatchId ?? ""}
                onChange={(e) => handleBatchChange(Number(e.target.value))}
                disabled={busy !== "" || uploading}
                style={{ minWidth: 280, height: 34, padding: "0 10px", margin: 0, boxSizing: "border-box" }}
              >
                {!batches.length && <option value="">暂无已上传批次</option>}
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batch_name}（{b.row_count} 条，{b.created_at}）
                  </option>
                ))}
              </select>
            </div>
            <label
              className="primary button"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                height: 34,
                padding: "0 14px",
                margin: 0,
                borderRadius: "var(--radius, 4px)",
                background: "var(--primary, #0066cc)",
                color: "#fff",
                fontSize: "13px",
                whiteSpace: "nowrap",
                boxSizing: "border-box",
              }}
            >
              {uploading ? "上传中..." : "上传新 CSV"}
              <input type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => void handleFileUpload(e)} disabled={uploading} />
            </label>
            {!!selectedBatchId && (
              <button
                type="button"
                className="button danger"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 34,
                  padding: "0 14px",
                  margin: 0,
                  fontSize: "13px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  boxSizing: "border-box",
                }}
                disabled={busy !== "" || uploading}
                onClick={() => void handleDeleteBatch()}
              >
                删除当前批次
              </button>
            )}
            <span className="muted" style={{ fontSize: "12px", marginLeft: 4, whiteSpace: "nowrap" }}>
              上传后自动固化入库 · 💡 双击任意单元格可在线修改内容
            </span>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}><input type="checkbox" aria-label="全选当前页" style={{ minHeight: 0 }} checked={allSelected} onChange={toggleAll} /></th>
                {columns.map((c) => <th key={c.key} style={{ whiteSpace: "nowrap" }}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><input type="checkbox" aria-label={`选择 ${String(item[columns[0]?.key] ?? item.id)}`} style={{ minHeight: 0 }} checked={selected.has(item.id)} onChange={() => toggleItem(item.id)} /></td>
                  {columns.map((c, idx) => {
                    const isEditing = source === "custom" && editingCell?.id === item.id && editingCell?.key === c.key;
                    return (
                      <td
                        key={c.key}
                        className={c.key.includes("code") ? "mono" : (source !== "custom" && idx === 0 ? "text-col" : "")}
                        style={{ whiteSpace: "nowrap", padding: isEditing ? "2px 4px" : undefined }}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editDraft}
                            style={{
                              padding: "3px 6px",
                              fontSize: 13,
                              border: "1px solid var(--primary, #0066cc)",
                              borderRadius: 3,
                              outline: "none",
                              minWidth: 80,
                              background: "var(--surface, #fff)",
                            }}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void saveCellEdit(item.id, c.key, editDraft);
                              } else if (e.key === "Escape") {
                                setEditingCell(null);
                              }
                            }}
                            onBlur={() => {
                              void saveCellEdit(item.id, c.key, editDraft);
                            }}
                          />
                        ) : (
                          <span
                            title={source === "custom" ? "双击修改内容" : undefined}
                            onDoubleClick={source === "custom" ? () => {
                              setEditingCell({ id: item.id, key: c.key });
                              setEditDraft(String(item[c.key] ?? ""));
                            } : undefined}
                            style={source === "custom" ? { cursor: "cell", display: "inline-block", minWidth: 20 } : undefined}
                          >
                            {value(item, c.key)}
                          </span>
                        )}
                      </td>
                    );
                  })}
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
              {t.label}<span className="flag">{slotSize} mm</span><span className="muted">{t.hint}</span>
            </label>
          ))}
          {customs.map((t) => (
            <label key={t.id} style={{ display: "flex", gap: 6, alignItems: "center", marginRight: 12 }}>
              <input type="radio" name="template" style={{ minHeight: 0 }} checked={template === `custom:${t.id}`} onChange={() => switchTemplate(`custom:${t.id}`)} />
              {t.name}<span className="flag">自定义</span>
            </label>
          ))}
        </div>
        <div className="toolbar" style={{ flexWrap: "wrap" }}>
          <strong>打印字段</strong>
          {fields.map((field) => (
            <label key={field.key} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" style={{ minHeight: 0 }} checked={selectedFields.includes(field.key)} disabled={!!custom} onChange={() => toggleField(field.key)} />
              {field.label}
            </label>
          ))}
          <span className="muted">{custom
            ? `字段与顺序由模板「${custom.name}」决定：${custom.fields.map((f) => fields.find((x) => x.key === f.key)?.label ?? f.key).join(" → ")}`
            : template === "name-only" ? "仅名称模板只打印第一个选中字段" : "第一个选中字段作为大字标题，其余逐行"}</span>
        </div>
      </section>

      <section className="panel" style={{ position: "sticky", bottom: 0, zIndex: 2 }}>
        <div className="toolbar">
          <span>已选 <strong>{ids.length}</strong> 条{source === "cells" && byTubeCount && <>（共 <strong>{totalLabels}</strong> 管）</>}</span>
          <span className="muted">双列纸约 {sheets} 张</span>
          <button className="link" onClick={() => { setSelected(new Set()); setPreview(null); }} disabled={!ids.length}>清空选择</button>
          <span className="muted">纸张 {sheetSize} · {media.columns} 列</span>
          <span className="spacer" />
          {source === "cells" && (
            <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", marginRight: 12 }}>
              <input
                type="checkbox"
                style={{ minHeight: 0 }}
                checked={byTubeCount}
                onChange={(e) => {
                  setByTubeCount(e.target.checked);
                  setPreview(null);
                }}
              />
              按在库管数打印对应张数（每管一张）
            </label>
          )}
          <label className="field">份数
            <input type="number" min={1} max={20} step={1} style={{ width: 80 }} value={copies} onChange={(e) => setCopies(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} />
          </label>
          <label className="field">打印机
            <select
              value={printerId}
              onChange={(e) => {
                const nextId = e.target.value;
                setPrinterId(nextId);
                setPreview(null);
                const p = printers.find((x) => String(x.id) === nextId);
                const qKey = p ? `?printer_id=${encodeURIComponent(p.printer_key)}` : "";
                api<Media>(`/api/v1/label-print/media${qKey}`).then(setMedia, () => {});
              }}
            >
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
            模板：{preview.template_label ?? TEMPLATES.find((t) => t.key === (preview.template ?? template))?.label ?? template}；
            字段：{preview.fields.map((key) => fields.find((f) => f.key === key)?.label ?? key).join("、")}
          </p>
          <div className="preview-grid">{preview.images.map((image, i) => (
            <figure key={i} className="label-figure">
              <div className="label-frame">
                <span className="label-dim">整张 {(preview.media?.width_mm ?? media.width_mm)} × {(preview.media?.height_mm ?? media.height_mm)} mm</span>
                <img src={`data:image/png;base64,${image}`} alt={`第 ${i + 1} 张标签纸预览`} />
                <span className="label-cut" aria-hidden="true" />
                <span className="label-dim slot">单格 {slotSize} mm</span>
              </div>
              <figcaption className="muted">第 {i + 1} 张标签纸 · 预览按实际比例等比显示</figcaption>
            </figure>
          ))}</div>
          <button className="primary" onClick={() => void print()} disabled={busy !== "" || !printerId}>确认打印（{copies} 份）</button>
        </section>
      )}
    </>
  );
}
