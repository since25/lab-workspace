"use client";

import { useEffect, useState } from "react";
import { api, errText } from "@/lib/client";
import Combobox from "../../Combobox";

interface User {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "member";
  freezer_view_all: boolean;
  label_print_enabled: boolean;
  is_active: boolean;
  locked_until: string | null;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ username: "", display_name: "", password: "", role: "member", freezer_view_all: false, label_print_enabled: true });
  const [error, setError] = useState("");

  const load = () => api<{ users: User[] }>("/api/v1/admin/users").then((u) => setUsers(u.users), (e) => setError(errText(e)));
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/v1/admin/users", { method: "POST", body: JSON.stringify(form) });
      setForm({ username: "", display_name: "", password: "", role: "member", freezer_view_all: false, label_print_enabled: true });
      load();
    } catch (err) {
      setError(errText(err));
    }
  }

  async function patch(u: User, body: Record<string, unknown>) {
    try {
      await api(`/api/v1/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify(body) });
      load();
    } catch (err) {
      alert(errText(err));
    }
  }

  function resetPassword(u: User) {
    const pw = window.prompt(`为 ${u.display_name} 设置新密码（至少 8 位），设置后请当面告知本人：`);
    if (pw) patch(u, { password: pw });
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <>
      <h1>账号管理</h1>
      <form className="panel" onSubmit={create}>
        <div className="form-grid">
          <label className="field">用户名（登录用）<input value={form.username} onChange={set("username")} required /></label>
          <label className="field">姓名<input value={form.display_name} onChange={set("display_name")} required /></label>
          <label className="field">初始密码（至少 8 位）<input value={form.password} onChange={set("password")} minLength={8} required /></label>
          <label className="field">
            角色
            <Combobox
              value={form.role}
              options={[{ value: "member", label: "普通成员" }, { value: "admin", label: "管理员" }]}
              onChange={(v) => setForm({ ...form, role: v })}
            />
          </label>
          {form.role === "member" && (
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" style={{ minHeight: 0 }} checked={form.freezer_view_all} onChange={(e) => setForm({ ...form, freezer_view_all: e.target.checked })} />
              冰箱总览（只读查看全部人员的冰箱内容）
            </label>
          )}
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" style={{ minHeight: 0 }} checked={form.label_print_enabled} onChange={(e) => setForm({ ...form, label_print_enabled: e.target.checked })} />
            标签打印（可见「标签打印」入口）
          </label>
        </div>
        {error && <div className="error">{error}</div>}
        <button className="primary">创建账号</button>
      </form>
      <p className="muted">「冰箱总览」和「标签打印」都是账号级附加权限：前者可只读查看全部人员的冰箱内容，后者决定是否显示「标签打印」入口并能提交打印；管理员本身即可查看冰箱总览，标签打印按开关执行。不涉及登录与停用。</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>用户名</th><th>姓名</th><th>角色</th><th>状态</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.display_name}</td>
                <td>
                  {u.role === "admin" ? "管理员" : "普通成员"}
                  {u.role === "member" && u.freezer_view_all && <> <span className="flag">冰箱总览</span></>}
                  {u.label_print_enabled && <> <span className="flag">标签打印</span></>}
                </td>
                <td>
                  {u.is_active ? "正常" : <span className="muted">已停用</span>}
                  {u.locked_until && new Date(u.locked_until) > new Date() && <> <span className="flag">临时锁定</span></>}
                </td>
                <td className="actions">
                  <button className="link" onClick={() => resetPassword(u)}>重置密码</button>
                  <button className="link" onClick={() => patch(u, { role: u.role === "admin" ? "member" : "admin" })}>
                    {u.role === "admin" ? "设为普通成员" : "设为管理员"}
                  </button>
                  {u.role === "member" && (
                    <button className="link" onClick={() => patch(u, { freezer_view_all: !u.freezer_view_all })}>
                      {u.freezer_view_all ? "取消冰箱总览" : "开启冰箱总览"}
                    </button>
                  )}
                  <button className="link" onClick={() => patch(u, { label_print_enabled: !u.label_print_enabled })}>
                    {u.label_print_enabled ? "关闭标签打印" : "开通标签打印"}
                  </button>
                  <button className="link" onClick={() => patch(u, { is_active: !u.is_active })}>{u.is_active ? "停用" : "启用"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
