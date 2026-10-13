"use client";

import { useEffect, useState } from "react";
import { api, download, errText } from "@/lib/client";
import type { Guide } from "@/lib/types";
import Combobox from "../Combobox";
import ImportBox from "../ImportBox";

const EMPTY = { name: "", target: "", sequence: "", pam: "", strand: "", target_position: "", bystander_position: "", target_base: "", edited_base: "", notes: "" };

export default function GuidesPage() {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [editing, setEditing] = useState<Guide | "new" | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState("");

  const load = () => api<{ guides: Guide[] }>("/api/v1/guides").then((d) => setGuides(d.guides), (e) => setError(errText(e)));
  useEffect(() => {
    load();
  }, []);

  async function remove(g: Guide) {
    if (!window.confirm(`删除 Guide「${g.name}」？`)) return;
    try {
      await api(`/api/v1/guides/${g.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      alert(errText(e));
    }
  }

  return (
    <>
      <h1>我的 Guide</h1>
      <p className="muted">只有你自己能看到和修改。分析时可以直接从这里选择 guide。</p>
      <div className="toolbar">
        <span className="spacer" />
        <button onClick={() => download("/api/v1/guides/export?template=1", "guide-template.csv").catch((e) => alert(errText(e)))}>下载导入模板</button>
        <button onClick={() => setShowImport(!showImport)}>批量导入</button>
        <button onClick={() => download("/api/v1/guides/export", "guides.csv").catch((e) => alert(errText(e)))}>导出 CSV</button>
        <button className="primary" onClick={() => setEditing("new")}>新增 Guide</button>
      </div>
      {showImport && (
        <ImportBox
          endpoint="/api/v1/guides/import"
          hint="使用「下载导入模板」或「导出 CSV」得到的表格填写（.csv 或 .xlsx）。名称与已有 Guide 相同时会覆盖该条，其余新增。"
          onDone={() => { setShowImport(false); load(); }}
          renderPreview={(d) => (
            <p>解析到 {String(d.total)} 条：新增 {String(d.new_rows)} 条，覆盖同名 {String(d.updates)} 条。</p>
          )}
        />
      )}
      {error && <div className="error">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>名称</th><th>靶点</th><th>序列</th><th>PAM</th><th>链</th><th>目标位置</th><th>旁观位</th><th>编辑</th><th>备注</th><th></th></tr>
          </thead>
          <tbody>
            {guides.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td>{g.target}</td>
                <td className="mono">{g.sequence}</td>
                <td className="mono">{g.pam}</td>
                <td>{g.strand}</td>
                <td className="num">{g.target_position ?? ""}</td>
                <td className="num">{g.bystander_position ?? ""}</td>
                <td>{g.target_base && g.edited_base ? `${g.target_base}→${g.edited_base}` : ""}</td>
                <td>{g.notes}</td>
                <td className="actions">
                  <button className="link" onClick={() => setEditing(g)}>编辑</button>
                  <button className="link" onClick={() => remove(g)}>删除</button>
                </td>
              </tr>
            ))}
            {!guides.length && <tr><td colSpan={10} className="muted">还没有 Guide</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <GuideDialog guide={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function GuideDialog({ guide, onClose, onSaved }: { guide: Guide | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(() =>
    guide
      ? {
          ...guide,
          target_position: guide.target_position === null ? "" : String(guide.target_position),
          bystander_position: guide.bystander_position === null ? "" : String(guide.bystander_position),
        }
      : EMPTY
  );
  const [error, setError] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    try {
      if (guide) await api(`/api/v1/guides/${guide.id}`, { method: "PATCH", body: JSON.stringify(form) });
      else await api("/api/v1/guides", { method: "POST", body: JSON.stringify(form) });
      onSaved();
    } catch (e) {
      setError(errText(e));
    }
  }

  const bases = [{ value: "", label: "未填" }, "A", "C", "G", "T"];
  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <h2 style={{ marginTop: 0 }}>{guide ? "编辑 Guide" : "新增 Guide"}</h2>
        <div className="form-grid">
          <label className="field">名称<input value={form.name} onChange={set("name")} /></label>
          <label className="field">靶点 / 基因<input value={form.target} onChange={set("target")} /></label>
          <label className="field wide">序列<textarea value={form.sequence} onChange={set("sequence")} /></label>
          <label className="field">PAM<input value={form.pam} onChange={set("pam")} /></label>
          <label className="field">
            链方向
            <Combobox value={form.strand} options={[{ value: "", label: "未填" }, "+", "-"]} onChange={(v) => setForm({ ...form, strand: v })} />
          </label>
          <label className="field">目标位置（guide 内第几位）<input type="number" min={1} value={form.target_position} onChange={set("target_position")} /></label>
          <label className="field">旁观位（选填，guide 内第几位）<input type="number" min={1} value={form.bystander_position} onChange={set("bystander_position")} /></label>
          <label className="field">
            目标碱基
            <Combobox value={form.target_base} options={bases} onChange={(v) => setForm({ ...form, target_base: v })} />
          </label>
          <label className="field">
            编辑后碱基
            <Combobox value={form.edited_base} options={bases} onChange={(v) => setForm({ ...form, edited_base: v })} />
          </label>
          <label className="field wide">备注<input value={form.notes} onChange={set("notes")} /></label>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="dialog-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
