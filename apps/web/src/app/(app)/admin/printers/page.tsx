"use client";

import { useEffect, useState } from "react";
import { api, errText } from "@/lib/client";

type Printer = { id: number; printer_key: string; name: string; enabled: boolean; is_default: boolean };

export default function PrintersPage() {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [form, setForm] = useState({ printer_key: "", name: "", is_default: false });
  const [error, setError] = useState("");
  const load = () => api<{ printers: Printer[] }>("/api/v1/admin/printers").then((d) => setPrinters(d.printers), (e) => setError(errText(e)));
  useEffect(() => { load(); }, []);
  async function create(e: React.FormEvent) { e.preventDefault(); setError(""); try { await api("/api/v1/admin/printers", { method: "POST", body: JSON.stringify(form) }); setForm({ printer_key: "", name: "", is_default: false }); load(); } catch (e) { setError(errText(e)); } }
  async function patch(p: Printer, body: Record<string, unknown>) { try { await api(`/api/v1/admin/printers/${p.id}`, { method: "PATCH", body: JSON.stringify(body) }); load(); } catch (e) { setError(errText(e)); } }
  return <>
    <h1>打印机管理</h1>
    <p className="muted">打印机标识必须对应 labelprint 服务所在 Windows 主机上的打印队列名称或设备标识。工作台会在打印页显示实时状态。</p>
    <form className="panel" onSubmit={create}><div className="form-grid">
      <label className="field">服务标识<input value={form.printer_key} placeholder="例如 Brady BBP12" onChange={(e) => setForm({ ...form, printer_key: e.target.value })} required /></label>
      <label className="field">显示名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" style={{ minHeight: 0 }} checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />设为默认</label>
    </div>{error && <div className="error">{error}</div>}<button className="primary">添加打印机</button></form>
    <div className="table-wrap"><table><thead><tr><th>显示名称</th><th>服务标识</th><th>启用</th><th>默认</th><th></th></tr></thead><tbody>
      {printers.map((p) => <tr key={p.id}><td>{p.name}</td><td className="mono">{p.printer_key}</td><td>{p.enabled ? "启用" : "停用"}</td><td>{p.is_default ? "是" : ""}</td><td className="actions"><button className="link" onClick={() => patch(p, { enabled: !p.enabled })}>{p.enabled ? "停用" : "启用"}</button><button className="link" onClick={() => patch(p, { is_default: true })}>设为默认</button></td></tr>)}
    </tbody></table></div>
  </>;
}
