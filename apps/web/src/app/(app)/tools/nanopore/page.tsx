"use client";

import { useState } from "react";
import { api, download, errText } from "@/lib/client";
import Combobox from "../../Combobox";
import { BASES, GuidePicker, QueueBox, QueuePolicy, ResultTable, useAnalysisRunner } from "../shared";

export default function NanoporePage() {
  const [job, setJob] = useState("");
  const [samples, setSamples] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [p, setP] = useState({ guide: "", target_position: "", target_base: "A", edited_base: "G", bystander_position: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const runner = useAnalysisRunner();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setP({ ...p, [k]: e.target.value });

  async function upload(file: File) {
    setBusy("正在上传交付包…");
    setError("");
    runner.reset();
    try {
      if (job) await api(`/api/v1/analysis/jobs/${job}`, { method: "DELETE" }).catch(() => {});
      const d = await api<{ job: string; samples: string[] }>(`/api/v1/analysis/nanopore/upload?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        body: file,
        headers: { "Content-Type": "application/octet-stream" },
      });
      setJob(d.job);
      setSamples(d.samples);
      setPicked(new Set(d.samples));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy("");
    }
  }

  async function run() {
    setError("");
    const rows = samples
      .filter((s) => picked.has(s))
      .map((s) => ({
        file: s,
        guide: p.guide.toUpperCase().replace(/\s+/g, ""),
        target_position: Number(p.target_position),
        target_base: p.target_base,
        edited_base: p.edited_base,
        bystander_position: p.bystander_position ? Number(p.bystander_position) : undefined,
      }));
    try {
      await runner.submit("/api/v1/analysis/nanopore/analyze", { job, rows });
    } catch (e) {
      setError(errText(e));
    }
  }

  async function clearAll() {
    if (job) {
      try {
        await api(`/api/v1/analysis/jobs/${job}`, { method: "DELETE" });
      } catch (e) {
        return setError(errText(e));
      }
    }
    setJob("");
    setSamples([]);
    setPicked(new Set());
    runner.reset();
  }

  const st = runner.state;

  const toggle = (s: string) => {
    const n = new Set(picked);
    if (n.has(s)) n.delete(s);
    else n.add(s);
    setPicked(n);
  };

  return (
    <>
      <h1>纳米孔分析</h1>
      <p className="muted">
        直接上传测序公司的交付包 .zip。系统只取每个样本的 Sequences、Bam、Frequency_tables、Suspious_sites 四类文件，其余（FASTQ、QC 图等）不保存。逐位点读值优先取自 BAM，没有 BAM 时用频率表；频率表截断、为空或与 BAM 不符会写在结果的 Data_Note 列。
      </p>
      <QueuePolicy />
      <div className="panel">
        <div className="form-grid">
          <label className="field wide">
            交付包
            <input type="file" accept=".zip" disabled={!!busy || runner.busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          {samples.length > 0 && (
            <div className="wide">
              识别到 {samples.length} 个样本，已选 {picked.size} 个。
              <button className="link" onClick={clearAll} disabled={runner.busy}>清除交付包</button>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginTop: 6 }}>
                {samples.map((s) => (
                  <label key={s} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input type="checkbox" style={{ minHeight: 0 }} checked={picked.has(s)} onChange={() => toggle(s)} />
                    {s}
                  </label>
                ))}
              </div>
            </div>
          )}
          <GuidePicker
            onPick={(g) =>
              setP({
                ...p,
                guide: g.sequence,
                target_position: g.target_position ? String(g.target_position) : p.target_position,
                bystander_position: g.bystander_position ? String(g.bystander_position) : p.bystander_position,
                target_base: g.target_base || p.target_base,
                edited_base: g.edited_base || p.edited_base,
              })
            }
          />
          <label className="field wide">
            Guide 设计序列
            <textarea value={p.guide} onChange={set("guide")} />
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
          <label className="field">
            旁观位（可选）
            <input type="number" min={1} value={p.bystander_position} onChange={set("bystander_position")} />
          </label>
        </div>
        <div className="toolbar">
          <button className="primary" onClick={run} disabled={!!busy || runner.busy || !job || !picked.size}>{runner.busy ? "排队/分析中…" : "开始分析"}</button>
          {busy && <span className="muted">{busy}</span>}
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
                下载结果包（Excel）
              </button>
            )}
          </div>
          <ResultTable result={st.result} />
        </>
      )}
    </>
  );
}
