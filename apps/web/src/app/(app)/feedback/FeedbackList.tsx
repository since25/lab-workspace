"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, errText } from "@/lib/client";

interface Thread {
  id: number;
  title: string;
  status: "open" | "closed";
  created_at: string;
  last_post_at: string;
  author_name: string;
  reply_count: number;
  unread: boolean;
}

const STATUS_TABS = [
  { value: "open", label: "待处理" },
  { value: "closed", label: "已解决" },
  { value: "all", label: "全部" },
];
const fmtTime = (s: string) => new Date(s).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });

export default function FeedbackList({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState("open");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ title: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    () => api<{ threads: Thread[] }>(`/api/v1/feedback?status=${status}`).then((d) => setThreads(d.threads), (e) => setError(errText(e))),
    [status]
  );
  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const d = await api<{ id: number }>("/api/v1/feedback", { method: "POST", body: JSON.stringify(form) });
      router.push(`/feedback/${d.id}`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <>
      <h1>留言板</h1>
      <p className="muted">
        {isAdmin
          ? "所有成员的留言都在这里。有新留言或新回复时，导航栏「留言板」上会显示数字。"
          : "有问题、建议或发现错误，可以在这里留言给管理员。只有你和管理员能看到你的留言；管理员回复后，导航栏「留言板」上会显示数字。"}
      </p>
      <div className="toolbar">
        <div className="tabs" role="tablist" style={{ marginBottom: 0, borderBottom: "none" }}>
          {STATUS_TABS.map((t) => (
            <button key={t.value} role="tab" aria-selected={status === t.value} className={status === t.value ? "active" : ""} onClick={() => setStatus(t.value)}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {!composing && <button className="primary" onClick={() => setComposing(true)}>写留言</button>}
      </div>

      {composing && (
        <div className="panel">
          <label className="field" style={{ marginBottom: 12 }}>
            标题
            <input value={form.title} maxLength={100} placeholder="一句话说明，如：细胞冻存导出缺少备注列" onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="field">
            内容
            <textarea className="prose" value={form.body} maxLength={5000} style={{ minHeight: 120 }} placeholder="具体情况、在哪个页面、期望怎样" onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </label>
          {error && <div className="error">{error}</div>}
          <div className="dialog-actions">
            <button onClick={() => { setComposing(false); setError(""); }}>取消</button>
            <button className="primary" onClick={submit} disabled={busy || !form.title.trim() || !form.body.trim()}>提交</button>
          </div>
        </div>
      )}
      {!composing && error && <div className="error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>标题</th>{isAdmin && <th>留言人</th>}<th>状态</th><th>回复</th><th>最后更新</th></tr>
          </thead>
          <tbody>
            {threads.map((t) => (
              <tr key={t.id}>
                <td className="text-col">
                  {t.unread && <span className="dot" aria-label="有新内容" />}
                  <Link href={`/feedback/${t.id}`} style={t.unread ? { fontWeight: 600 } : undefined}>{t.title}</Link>
                </td>
                {isAdmin && <td className="nw">{t.author_name}</td>}
                <td className="nw">{t.status === "open" ? <span className="flag">待处理</span> : <span className="muted">已解决</span>}</td>
                <td className="num">{t.reply_count}</td>
                <td className="nw">{fmtTime(t.last_post_at)}</td>
              </tr>
            ))}
            {!threads.length && <tr><td colSpan={5} className="muted">暂无留言</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
