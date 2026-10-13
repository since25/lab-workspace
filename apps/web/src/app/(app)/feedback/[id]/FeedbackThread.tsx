"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errText } from "@/lib/client";

interface Thread {
  id: number;
  title: string;
  status: "open" | "closed";
  created_at: string;
  author_name: string;
}
interface Post {
  id: number;
  body: string;
  created_at: string;
  author_name: string | null;
  by_admin: boolean | null;
}

export default function FeedbackThread({ id, isAdmin }: { id: number; isAdmin: boolean }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      api<{ thread: Thread; posts: Post[] }>(`/api/v1/feedback/${id}`).then(
        (d) => {
          setThread(d.thread);
          setPosts(d.posts);
          // 打开即已读：通知导航栏刷新角标
          window.dispatchEvent(new Event("feedback-read"));
        },
        (e) => setError(errText(e))
      ),
    [id]
  );
  useEffect(() => {
    load();
  }, [load]);

  async function send() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/feedback/${id}/posts`, { method: "POST", body: JSON.stringify({ body: reply }) });
      setReply("");
      await load();
    } catch (e) {
      setError(errText(e));
    }
    setBusy(false);
  }

  async function setStatus(status: "open" | "closed") {
    setError("");
    try {
      await api(`/api/v1/feedback/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (e) {
      setError(errText(e));
    }
  }

  return (
    <>
      <p><Link href="/feedback">← 返回留言板</Link></p>
      {error && <div className="error">{error}</div>}
      {thread && (
        <>
          <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginBottom: 16 }}>
            <h1 style={{ margin: 0 }}>{thread.title}</h1>
            {thread.status === "open" ? <span className="flag">待处理</span> : <span className="muted">已解决</span>}
            <span className="spacer" style={{ flex: 1 }} />
            {isAdmin && (thread.status === "open"
              ? <button onClick={() => setStatus("closed")}>标记为已解决</button>
              : <button onClick={() => setStatus("open")}>重新打开</button>)}
          </div>
          {posts.map((p) => (
            <div key={p.id} className={`panel post${p.by_admin ? " by-admin" : ""}`}>
              <div className="muted" style={{ marginBottom: 6 }}>
                {p.author_name ?? "（已删除的账号）"}{p.by_admin && " · 管理员"} · {new Date(p.created_at).toLocaleString("zh-CN")}
              </div>
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{p.body}</div>
            </div>
          ))}
          <label className="field">
            回复
            <textarea className="prose" value={reply} maxLength={5000} style={{ minHeight: 96 }} onChange={(e) => setReply(e.target.value)} />
          </label>
          <div className="dialog-actions" style={{ marginTop: 8 }}>
            <button className="primary" onClick={send} disabled={busy || !reply.trim()}>发送回复</button>
          </div>
        </>
      )}
    </>
  );
}
