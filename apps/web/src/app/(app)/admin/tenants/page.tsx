"use client";

import { useEffect, useState } from "react";
import { api, errText } from "@/lib/client";

type Tenant = { id: number; slug: string; name: string; is_active: boolean; label_print_enabled: boolean };

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [form, setForm] = useState({ slug: "", name: "", label_print_enabled: false });
  const [error, setError] = useState("");
  const load = () => api<{ tenants: Tenant[] }>("/api/v1/admin/tenants").then((d) => setTenants(d.tenants), (e) => setError(errText(e)));
  useEffect(() => { load(); }, []);
  async function create(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try { await api("/api/v1/admin/tenants", { method: "POST", body: JSON.stringify(form) }); setForm({ slug: "", name: "", label_print_enabled: false }); load(); }
    catch (e) { setError(errText(e)); }
  }
  async function patch(t: Tenant, body: Record<string, unknown>) {
    try { await api(`/api/v1/admin/tenants/${t.id}`, { method: "PATCH", body: JSON.stringify(body) }); load(); }
    catch (e) { setError(errText(e)); }
  }
  return <>
    <h1>租户管理</h1>
    <p className="muted">打印功能按租户开启。停用打印后，该租户成员看不到标签打印入口，直接访问也会被拒绝。</p>
    <form className="panel" onSubmit={create}><div className="form-grid">
      <label className="field">租户标识<input value={form.slug} placeholder="例如 research" onChange={(e) => setForm({ ...form, slug: e.target.value })} required /></label>
      <label className="field">租户名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" style={{ minHeight: 0 }} checked={form.label_print_enabled} onChange={(e) => setForm({ ...form, label_print_enabled: e.target.checked })} />开启标签打印</label>
    </div>{error && <div className="error">{error}</div>}<button className="primary">创建租户</button></form>
    <div className="table-wrap"><table><thead><tr><th>标识</th><th>名称</th><th>状态</th><th>标签打印</th><th></th></tr></thead><tbody>
      {tenants.map((t) => <tr key={t.id}><td className="mono">{t.slug}</td><td>{t.name}</td><td>{t.is_active ? "正常" : "已停用"}</td><td>{t.label_print_enabled ? "已开放" : "未开放"}</td><td className="actions"><button className="link" onClick={() => patch(t, { label_print_enabled: !t.label_print_enabled })}>{t.label_print_enabled ? "关闭打印" : "开放打印"}</button><button className="link" onClick={() => patch(t, { is_active: !t.is_active })}>{t.is_active ? "停用租户" : "启用租户"}</button></td></tr>)}
    </tbody></table></div>
  </>;
}
