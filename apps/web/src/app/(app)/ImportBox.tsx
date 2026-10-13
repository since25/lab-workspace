"use client";

import { useState } from "react";
import { errText } from "@/lib/client";

interface Issue { sheet: string; row: number; message: string }
type Result = Record<string, unknown> & { issues?: Issue[]; batch_id?: number };

// 两步导入：先预览（不写库），确认后提交
export default function ImportBox({
  endpoint, hint, confirmText = "确认导入", renderPreview, onDone,
}: {
  endpoint: string;
  hint: string;
  confirmText?: string;
  renderPreview: (d: Result) => React.ReactNode;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(mode: "preview" | "commit") {
    if (!file) return;
    setBusy(true);
    setError("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mode", mode);
    try {
      const res = await fetch(endpoint, { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "导入失败");
      if (mode === "preview") setPreview(d);
      else setDone(d);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const issues = (preview?.issues ?? []) as Issue[];
  return (
    <div className="panel">
      <p className="muted">{hint}</p>
      {!done && (
        <div className="toolbar">
          <input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
          <button onClick={() => send("preview")} disabled={!file || busy}>预览</button>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {preview && !done && (
        <>
          {renderPreview(preview)}
          {issues.length > 0 && (
            <div className="notice warn">
              以下 {issues.length} 行不会导入：
              <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                {issues.slice(0, 20).map((i, k) => (
                  <li key={k}>{i.sheet} 第 {i.row} 行：{i.message}</li>
                ))}
                {issues.length > 20 && <li>……共 {issues.length} 行</li>}
              </ul>
            </div>
          )}
          <button className="primary" onClick={() => send("commit")} disabled={busy}>{confirmText}</button>
        </>
      )}
      {done && (
        <>
          <p>导入完成。</p>
          {(done.issues?.length ?? 0) > 0 && (
            <p><a href={`/api/v1/imports/${done.batch_id}/errors`}>下载未导入行清单</a></p>
          )}
          <button onClick={onDone}>关闭</button>
        </>
      )}
    </div>
  );
}
