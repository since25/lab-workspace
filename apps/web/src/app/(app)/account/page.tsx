"use client";

import { useState } from "react";
import { api, errText } from "@/lib/client";

export default function AccountPage() {
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setMsg("");
    setError("");
    if (f.get("new_password") !== f.get("confirm")) return setError("两次输入的新密码不一致");
    try {
      await api("/api/v1/auth/password", {
        method: "PATCH",
        body: JSON.stringify({ current_password: f.get("current_password"), new_password: f.get("new_password") }),
      });
      form.reset();
      setMsg("密码已修改");
    } catch (err) {
      setError(errText(err));
    }
  }

  return (
    <>
      <h1>修改密码</h1>
      <form className="panel" style={{ maxWidth: 400 }} onSubmit={submit}>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
          <label className="field">当前密码<input name="current_password" type="password" autoComplete="current-password" required /></label>
          <label className="field">新密码（至少 8 位）<input name="new_password" type="password" autoComplete="new-password" minLength={8} required /></label>
          <label className="field">再次输入新密码<input name="confirm" type="password" autoComplete="new-password" required /></label>
        </div>
        {error && <div className="error">{error}</div>}
        {msg && <p>{msg}</p>}
        <button className="primary">保存</button>
      </form>
    </>
  );
}
