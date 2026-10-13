"use client";

import { useState } from "react";
import { api, errText } from "@/lib/client";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: f.get("username"), password: f.get("password") }),
      });
      window.location.href = "/";
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="panel">
        <h1>实验室工作台</h1>
        <form onSubmit={submit}>
          <label className="field">
            用户名
            <input name="username" autoComplete="username" autoFocus required />
          </label>
          <label className="field">
            密码
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy}>
            {busy ? "登录中…" : "登录"}
          </button>
          <p className="muted">账号由管理员创建；忘记密码请联系管理员重置。</p>
        </form>
      </div>
    </div>
  );
}
