"use client";

import { useMemo, useRef, useState } from "react";
import { api, download, errText } from "@/lib/client";
import { RENAME_PRESETS, previewNames } from "@/lib/rename";
import Combobox from "../../Combobox";
import { BASES, GuidePicker, QueueBox, QueuePolicy, ResultTable, useAnalysisRunner } from "../shared";

interface FileRow {
  key: string;
  local: string; // 用户选择的文件名
  stored: string[]; // 服务器上的文件名（重名会被加 _1；zip 会展开成多个）
  size: number;
  status: "pending" | "uploading" | "done" | "failed";
  error?: string;
}

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function SangerPage() {
  const [job, setJob] = useState("");
  const [rows, setRows] = useState<FileRow[]>([]);
  const [p, setP] = useState({ sequence: "", target_position: "", target_base: "A", edited_base: "G", ref_sequence: "", preset: "", pattern: "", replacement: "", tag: "" });
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const jobRef = useRef("");
  const runner = useAnalysisRunner();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setP({ ...p, [k]: e.target.value });

  // 规则：预设或自定义；替换串用 \1 写法，与分析服务一致
  const rule = p.preset === "custom" ? { pattern: p.pattern, replacement: p.replacement } : RENAME_PRESETS.find((x) => x.id === p.preset)!;
  const stored = rows.filter((r) => r.status === "done").flatMap((r) => r.stored);
  const storedKey = stored.join("\u0001");
  const { names, ruleError } = useMemo(() => {
    const list = storedKey ? storedKey.split("\u0001") : [];
    try {
      const out = previewNames(list, rule.pattern, rule.replacement, p.tag);
      return { names: new Map(list.map((s, i) => [s, out[i]])), ruleError: "" };
    } catch {
      return { names: new Map<string, string>(), ruleError: "正则表达式写法有误" };
    }
  }, [storedKey, rule.pattern, rule.replacement, p.tag]);

  // 选中文件后立即逐个上传；表格实时显示每个文件的状态
  async function addFiles(files: File[]) {
    if (!files.length) return;
    setError("");
    runner.reset();
    const added = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, local: f.name, stored: [], size: f.size, status: "pending" as const }));
    setRows((r) => [...r, ...added]);
    setUploading(true);
    for (let i = 0; i < files.length; i++) {
      const key = added[i].key;
      const patch = (x: Partial<FileRow>) => setRows((r) => r.map((row) => (row.key === key ? { ...row, ...x } : row)));
      patch({ status: "uploading" });
      try {
        const q = new URLSearchParams({ filename: files[i].name });
        if (jobRef.current) q.set("job", jobRef.current);
        const d = await api<{ job: string; files: string[] }>(`/api/v1/analysis/sanger/upload?${q}`, {
          method: "POST",
          body: files[i],
          headers: { "Content-Type": "application/octet-stream" },
        });
        jobRef.current = d.job;
        setJob(d.job);
        patch({ status: "done", stored: d.files });
      } catch (e) {
        patch({ status: "failed", error: errText(e) });
      }
    }
    setUploading(false);
    if (input.current) input.current.value = "";
  }

  async function clearAll() {
    if (jobRef.current) {
      try {
        await api(`/api/v1/analysis/jobs/${jobRef.current}`, { method: "DELETE" });
      } catch (e) {
        return setError(errText(e));
      }
    }
    jobRef.current = "";
    setJob("");
    setRows([]);
    setError("");
    runner.reset();
  }

  async function run() {
    setError("");
    try {
      await runner.submit("/api/v1/analysis/sanger/analyze", {
        job,
        sequence: p.sequence,
        target_position: Number(p.target_position),
        target_base: p.target_base,
        edited_base: p.edited_base,
        ref_sequence: p.ref_sequence,
        rename_config: p.preset === "custom" ? { pattern: p.pattern, replacement: p.replacement, tag: p.tag } : { preset: p.preset, tag: p.tag },
      });
    } catch (e) {
      setError(errText(e));
    }
  }

  const st = runner.state;
  const locked = uploading || runner.busy;
  const doneCount = stored.length;

  return (
    <>
      <h1>Sanger 分析</h1>
      <p className="muted">上传 .ab1（可多选，也可以是含 .ab1 的 .zip），整批使用同一条 guide。文件只临时保存，24 小时后自动删除。</p>
      <QueuePolicy />

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>1. 测序文件</h2>
        <div className="toolbar">
          <input ref={input} type="file" multiple accept=".ab1,.zip" disabled={locked} onChange={(e) => addFiles(Array.from(e.target.files ?? []))} />
          <span className="spacer" />
          {rows.length > 0 && <button onClick={clearAll} disabled={locked}>清除全部文件</button>}
        </div>
        <div className="form-grid">
          <label className="field">
            结果命名规则
            <Combobox value={p.preset} options={RENAME_PRESETS.map((x) => ({ value: x.id, label: x.label }))} onChange={(v) => setP({ ...p, preset: v })} />
          </label>
          {p.preset === "custom" && (
            <>
              <label className="field">查找（正则）<input className="mono" value={p.pattern} onChange={set("pattern")} /></label>
              <label className="field">替换为（\1 表示第一个括号）<input className="mono" value={p.replacement} onChange={set("replacement")} /></label>
            </>
          )}
          <label className="field">
            名称后缀（可选，只保留字母数字 . _ -）
            <input value={p.tag} onChange={set("tag")} />
          </label>
        </div>
        {ruleError && <div className="error">{ruleError}</div>}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>原文件名</th><th>大小</th><th>状态</th><th>结果中的名称</th></tr>
              </thead>
              <tbody>
                {rows.flatMap((r, i) =>
                  (r.stored.length ? r.stored : [r.local]).map((s, j) => (
                    <tr key={`${r.key}-${j}`}>
                      <td className="num">{i + 1}{r.stored.length > 1 ? `.${j + 1}` : ""}</td>
                      <td className="mono">{r.stored.length > 1 ? `${r.local} › ${s}` : s}</td>
                      <td className="num">{j === 0 ? fmtSize(r.size) : ""}</td>
                      <td>
                        {r.status === "pending" && <span className="muted">等待上传</span>}
                        {r.status === "uploading" && "上传中…"}
                        {r.status === "done" && "已上传"}
                        {r.status === "failed" && <span className="error">失败：{r.error}</span>}
                      </td>
                      <td className="mono">{r.status === "done" ? names.get(s) ?? "" : ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && <p className="muted" style={{ marginTop: 8 }}>已上传 {doneCount} 个 .ab1 文件。修改命名规则后表格立即更新，分析结果和下载包使用同样的名称。</p>}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>2. 分析参数</h2>
        <div className="form-grid">
          <GuidePicker
            onPick={(g) =>
              setP({
                ...p,
                sequence: g.sequence,
                target_position: g.target_position ? String(g.target_position) : p.target_position,
                target_base: g.target_base || p.target_base,
                edited_base: g.edited_base || p.edited_base,
              })
            }
          />
          <label className="field wide">
            Guide 序列（A/C/G/T）
            <textarea value={p.sequence} onChange={set("sequence")} />
          </label>
          <label className="field">
            目标位置（guide 内第几位）
            <input type="number" min={1} value={p.target_position} onChange={set("target_position")} />
          </label>
          <label className="field">
            目标碱基
            <Combobox value={p.target_base} options={BASES} onChange={(v) => setP({ ...p, target_base: v })} />
          </label>
          <label className="field">
            编辑后碱基
            <Combobox value={p.edited_base} options={BASES} onChange={(v) => setP({ ...p, edited_base: v })} />
          </label>
          <label className="field wide">
            参考序列片段（可选，用于换算到参考坐标）
            <textarea value={p.ref_sequence} onChange={set("ref_sequence")} />
          </label>
        </div>
        <div className="toolbar">
          <button className="primary" onClick={run} disabled={locked || !doneCount || !!ruleError}>
            {runner.busy ? "排队/分析中…" : "开始分析"}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {st && <QueueBox state={st} />}
        {st && (st.status === "failed" || st.status === "lost") && <div className="error">{st.error}</div>}
      </div>

      {st?.status === "failed" && st.errors && st.errors.length > 0 && (
        <ResultTable result={{ summary: [], errors: st.errors, n_files: st.errors.length, n_success: 0 }} />
      )}
      {st?.status === "done" && st.result && (
        <>
          <div className="toolbar">
            <h2 style={{ margin: 0 }}>结果</h2>
            <span className="spacer" />
            {st.result.summary.length > 0 && (
              <button className="primary" onClick={() => download(`/api/v1/analysis/jobs/${job}/download`, "results.zip").catch((e) => alert(errText(e)))}>
                下载结果包（Excel + 重命名后的 .ab1）
              </button>
            )}
          </div>
          <ResultTable result={st.result} />
        </>
      )}
    </>
  );
}
