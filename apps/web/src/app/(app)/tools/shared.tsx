"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Guide } from "@/lib/types";
import Combobox from "../Combobox";

export type Row = Record<string, unknown>;
export interface AnalysisResult {
  summary: Row[];
  errors: Row[];
  n_files: unknown;
  n_success: unknown;
  elapsed_seconds?: unknown;
  celebrate?: { n: number; mine: number }; // 网页服务附加：本次成功样品数、我累计的同类样品数
}

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

// 汇总表：直接展示分析服务返回的全部列（与下载的 Excel summary 表一致）
export function ResultTable({ result }: { result: AnalysisResult }) {
  const rows = result.summary ?? [];
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const errors = result.errors ?? [];
  return (
    <>
      <p>
        共 {String(first(result.n_files))} 个，成功 {String(first(result.n_success))} 个
        {result.elapsed_seconds !== undefined && <span className="muted">，用时 {Number(first(result.elapsed_seconds)).toFixed(1)} 秒</span>}。
      </p>
      {errors.length > 0 && (
        <div className="notice warn">
          {errors.length} 个失败：
          <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            {errors.map((e, i) => (
              <li key={i}>{String(first(e.file))}：{String(first(e.error_label) ?? "")} {String(first(e.error) ?? "")}</li>
            ))}
          </ul>
        </div>
      )}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => {
                    const v = first(r[c]);
                    return <td key={c} className={typeof v === "number" ? "num" : ""}>{v === null || v === undefined ? "" : String(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// 分析完成后的祝贺提示（只在有成功样品时显示）
export function Celebrate({ result, label }: { result: AnalysisResult; label: string }) {
  const c = result.celebrate;
  if (!c || c.n <= 0) return null;
  return (
    <div className="notice celebrate" role="status">
      🎉 恭喜完成 <strong>{c.n}</strong> 个样品的{label}分析！你累计已分析 {label} 样品 <strong>{c.mine}</strong> 个。
    </div>
  );
}

// 从「我的 Guide」选择（可输入名称、靶点或序列片段筛选）后回填参数
export function GuidePicker({ onPick }: { onPick: (g: Guide) => void }) {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [value, setValue] = useState("");
  useEffect(() => {
    api<{ guides: Guide[] }>("/api/v1/guides").then((d) => setGuides(d.guides), () => {});
  }, []);
  return (
    <label className="field">
      从我的 Guide 选择
      <Combobox
        value={value}
        placeholder={guides.length ? "输入名称、靶点或序列筛选" : "（还没有 Guide）"}
        options={guides.map((g) => ({ value: String(g.id), label: `${g.name}${g.target ? `（${g.target}）` : ""} ${g.sequence}` }))}
        onChange={(v) => {
          setValue(v);
          const g = guides.find((x) => String(x.id) === v);
          if (g) onPick(g);
        }}
      />
    </label>
  );
}

export const BASES = ["A", "C", "G", "T"];

export interface QueueState {
  status: "queued" | "running" | "done" | "failed" | "lost" | "unknown";
  position: number;
  wait_seconds: number;
  elapsed_seconds: number;
  estimate_seconds: number;
  remaining_seconds: number;
  queue_length: number;
  result?: AnalysisResult;
  error?: string;
  errors?: Row[];
}

// 提交分析并轮询排队/运行状态，直到完成或失败
export function useAnalysisRunner() {
  const [state, setState] = useState<QueueState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const poll = useCallback((job: string) => {
    timer.current = setTimeout(async () => {
      try {
        const s = await api<QueueState>(`/api/v1/analysis/jobs/${job}`);
        setState(s);
        if (s.status === "queued" || s.status === "running") poll(job);
      } catch (e) {
        setState((p) => ({ ...(p as QueueState), status: "failed", error: e instanceof Error ? e.message : String(e) }));
      }
    }, 1500);
  }, []);

  const submit = useCallback(async (url: string, body: Record<string, unknown>) => {
    const s = await api<QueueState & { job: string }>(url, { method: "POST", body: JSON.stringify(body) });
    setState(s);
    poll(s.job);
  }, [poll]);

  const busy = state?.status === "queued" || state?.status === "running";
  return { state, submit, busy, reset: () => setState(null) };
}

const fmt = (s: number) => (s >= 90 ? `${Math.round(s / 60)} 分钟` : `${Math.max(1, Math.round(s))} 秒`);

// 排队与进度提示
export function QueueBox({ state }: { state: QueueState }) {
  if (state.status === "queued") {
    return (
      <div className="queue" role="status">
        <strong>排队中</strong>：前面还有 {state.position} 个任务，预计约 {fmt(state.wait_seconds)} 后开始，
        完成约需 {fmt(state.remaining_seconds)}。
      </div>
    );
  }
  if (state.status === "running") {
    const pct = state.estimate_seconds ? Math.min(95, (state.elapsed_seconds / state.estimate_seconds) * 100) : 0;
    return (
      <div className="queue" role="status">
        <strong>分析中</strong>：已用 {state.elapsed_seconds} 秒，
        {state.elapsed_seconds < state.estimate_seconds ? `预计还需约 ${fmt(state.remaining_seconds)}` : "即将完成"}。
        {state.queue_length > 1 && <span className="muted">（另有 {state.queue_length - 1} 个任务在排队）</span>}
        <div className="bar"><span style={{ width: `${pct}%` }} /></div>
      </div>
    );
  }
  return null;
}

export function QueuePolicy() {
  return (
    <p className="muted">
      排队说明：服务器只有一个分析进程，Sanger 与纳米孔分析全站共用一个队列，按提交先后依次执行，同一时间只运行一个任务。
      提交后页面会显示前面还有几个任务、预计等待和剩余时间（按近期实际耗时估算）。请保持本页打开直到出结果：离开页面不会取消任务，但结果只显示在提交它的页面上。
    </p>
  );
}
