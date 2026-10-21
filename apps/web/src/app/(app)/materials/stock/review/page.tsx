"use client";

import { Fragment, Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, errText } from "@/lib/client";

type View = "pending" | "inbound" | "done";

interface LinkRow {
  material_id: number;
  state: "pending" | "confirmed" | "stocked" | "skipped" | "excluded";
  confidence: "known" | "high" | "mid" | "low";
  stock_id: number | null;
  slot_label: string;
  slot_unit: string;
  item_name: string;
  brand: string;
  spec_model: string;
  unit: string;
  quantity: number | null;
  request_no: string;
  minor_category: string;
  requested_on: string | null;
  last_received_on: string | null;
  receipt_status: string;
  applied_qty: number | null;
  decided_by_name: string | null;
  decided_at: string | null;
}

interface Slot { id: number; category: string; item_name: string; unit: string }

interface LinksResponse {
  view: View;
  items: LinkRow[];
  counts: { pending: number; inbound: number };
  slots: Slot[];
}

const VIEWS: { key: View; label: string }[] = [
  { key: "pending", label: "待确认归属" },
  { key: "inbound", label: "待入库" },
  { key: "done", label: "已处理" },
];
const CONFIDENCE = { known: ["已知货号", "ok"], high: ["高", "ok"], mid: ["中", "stale"], low: ["低", "out"] } as const;
const RESULT = { stocked: "已入库", skipped: "不加数", excluded: "已排除", confirmed: "已归入", pending: "待确认" } as const;
const num = (value: number | null) => (value === null ? "—" : String(Number(value)));

function SlotSelect({ slots, value, onChange }: { slots: Slot[]; value: number | null; onChange: (id: number) => void }) {
  const groups = [...new Set(slots.map((s) => s.category))];
  return (
    <select value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))}>
      {value === null && <option value="">请选择槽位</option>}
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {slots.filter((s) => s.category === g).map((s) => <option key={s.id} value={s.id}>{s.item_name}（{s.unit || "—"}）</option>)}
        </optgroup>
      ))}
    </select>
  );
}

// 从库存页「待入库 N」进来时带 ?view=inbound；useSearchParams 需要包在 Suspense 里才能静态构建。
export default function StockReviewPage() {
  return <Suspense><StockReview /></Suspense>;
}

function StockReview() {
  const initial = useSearchParams().get("view");
  const [view, setView] = useState<View>(initial === "inbound" || initial === "done" ? initial : "pending");
  const [data, setData] = useState<LinksResponse | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  // 每行可改的建议槽位和入库数量，未改时用服务端给的值。
  const [choice, setChoice] = useState<Record<number, number>>({});
  const [amount, setAmount] = useState<Record<number, string>>({});

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      setData(await api<LinksResponse>(`/api/v1/materials/stock/links?view=${view}`, { signal }));
      setError("");
    } catch (e) {
      if (!signal.aborted) setError(errText(e));
    }
  }, [view]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => load(controller.signal), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load, refresh]);

  async function decide(row: LinkRow, action: "confirm" | "exclude" | "stock" | "skip") {
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = { action };
      if (action === "confirm") body.stock_id = choice[row.material_id] ?? row.stock_id;
      if (action === "stock" && amount[row.material_id] !== undefined) body.quantity = amount[row.material_id];
      const result = await api<{ updated: number }>(`/api/v1/materials/stock/links/${row.material_id}`, { method: "POST", body: JSON.stringify(body) });
      const extra = result.updated > 1 ? `，同货号另外 ${result.updated - 1} 条一并处理` : "";
      const label = { confirm: "已确认归属", exclude: "已排除", stock: "已入库", skip: "已标记不加数" }[action];
      setNotice(`${label}：${row.item_name}${extra}。`);
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  // 一键确认：只处理把握为「高」且未改动建议的行；同货号的记录会被服务端一并带走，所以逐条确认前先跳过已处理的。
  async function confirmHigh() {
    if (!data) return;
    const rows = data.items.filter((r) => r.confidence === "high" && r.stock_id !== null && choice[r.material_id] === undefined);
    if (!rows.length || !window.confirm(`按建议确认 ${rows.length} 条「高」把握记录的归属？中、低把握的仍需逐条确认。`)) return;
    setBusy(true);
    setError("");
    const done = new Set<number>();
    let ok = 0;
    try {
      for (const row of rows) {
        if (done.has(row.material_id)) continue;
        await api(`/api/v1/materials/stock/links/${row.material_id}`, { method: "POST", body: JSON.stringify({ action: "confirm", stock_id: row.stock_id }) });
        ok += 1;
        done.add(row.material_id);
      }
      setNotice(`已按建议确认 ${ok} 组。`);
    } catch (e) {
      setError(`确认到第 ${ok + 1} 组时失败：${errText(e)}`);
    } finally {
      setBusy(false);
      setRefresh((v) => v + 1);
    }
  }

  const rows = data?.items ?? [];
  const slots = data?.slots ?? [];

  return (
    <>
      <h1>核对工作台</h1>
      <p className="muted">
        「匹配采购记录」后，新采购会出现在这里。待确认归属：确认它属于哪个槽位，或排除（不是常用耗材）；确认过的货号会被记住，以后同货号的采购直接归入。
        待入库：槽位有基线后才出现，基线日以后的采购逐条确认加数（默认采购数量，可改），已在盘点中数过的选「不加数」。
      </p>
      <div className="toolbar">
        <Link href="/materials/stock">← 返回常用耗材</Link>
      </div>

      <div className="tabs">
        {VIEWS.map((v) => (
          <button key={v.key} className={view === v.key ? "active" : ""} onClick={() => { setView(v.key); setNotice(""); }}>
            {v.label}
            {v.key !== "done" && data && <span className="count">{data.counts[v.key]}</span>}
          </button>
        ))}
      </div>

      {view === "pending" && rows.some((r) => r.confidence === "high") && (
        <div className="toolbar">
          <span className="spacer" />
          <button disabled={busy} onClick={confirmHigh}>按建议确认全部「高」把握</button>
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {notice && <p role="status">{notice}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            {view === "pending" && (
              <tr><th>采购日期</th><th>采购名称</th><th>品牌</th><th>货号/规格</th><th>数量</th><th>OA 小类</th><th>建议槽位</th><th>把握</th><th>操作</th></tr>
            )}
            {view === "inbound" && (
              <tr><th>采购日期</th><th>收货</th><th>采购名称</th><th>品牌</th><th>货号/规格</th><th>采购数量</th><th>入库数量</th><th>操作</th></tr>
            )}
            {view === "done" && (
              <tr><th>处理时间</th><th>采购名称</th><th>品牌</th><th>槽位</th><th>结果</th><th>加数</th><th>处理人</th><th>改判</th></tr>
            )}
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const header = view !== "done" && (i === 0 || rows[i - 1].slot_label !== row.slot_label);
              const unitDiffers = row.slot_unit && row.unit && row.slot_unit !== row.unit;
              return (
                <Fragment key={row.material_id}>
                  {header && (
                    <tr className="stock-group">
                      <td colSpan={view === "pending" ? 9 : 8}>{row.slot_label || "（槽位已删除）"}{row.slot_unit && <span className="muted">　按 {row.slot_unit} 计</span>}</td>
                    </tr>
                  )}
                  {view === "pending" && (
                    <tr>
                      <td className="nw">{row.requested_on ?? "—"}</td>
                      <td className="text-col">{row.item_name}</td>
                      <td>{row.brand || "—"}</td>
                      <td className="mono">{row.spec_model || "—"}</td>
                      <td className="num nw">{num(row.quantity)} {row.unit}</td>
                      <td className="nw">{row.minor_category || "—"}</td>
                      <td><SlotSelect slots={slots} value={choice[row.material_id] ?? row.stock_id} onChange={(id) => setChoice({ ...choice, [row.material_id]: id })} /></td>
                      <td className="nw"><span className={`stock-status stock-${CONFIDENCE[row.confidence][1]}`}>{CONFIDENCE[row.confidence][0]}</span></td>
                      <td className="actions">
                        <button className="link" disabled={busy || (choice[row.material_id] ?? row.stock_id) === null} onClick={() => decide(row, "confirm")}>确认</button>
                        <button className="link danger" disabled={busy} onClick={() => decide(row, "exclude")}>排除</button>
                      </td>
                    </tr>
                  )}
                  {view === "inbound" && (
                    <tr>
                      <td className="nw">{row.requested_on ?? "—"}</td>
                      <td className="nw">{row.last_received_on ?? (row.receipt_status || "未收货")}</td>
                      <td className="text-col">{row.item_name}</td>
                      <td>{row.brand || "—"}</td>
                      <td className="mono">{row.spec_model || "—"}</td>
                      <td className="num nw">
                        {num(row.quantity)} {row.unit}
                        {unitDiffers && <div className="muted" title="采购单位与槽位计数单位不同，请按槽位单位换算后填写">≠ 槽位单位 {row.slot_unit}</div>}
                      </td>
                      <td>
                        <input type="number" min={0} step="0.01" style={{ width: 80 }}
                          value={amount[row.material_id] ?? (row.quantity === null ? "" : String(row.quantity))}
                          onChange={(e) => setAmount({ ...amount, [row.material_id]: e.target.value })} />
                      </td>
                      <td className="actions">
                        <button className="link" disabled={busy} onClick={() => decide(row, "stock")}>入库</button>
                        <button className="link" disabled={busy} onClick={() => decide(row, "skip")}>不加数</button>
                      </td>
                    </tr>
                  )}
                  {view === "done" && (
                    <tr>
                      <td className="nw">{row.decided_at ? new Date(row.decided_at).toLocaleString("zh-CN") : "自动"}</td>
                      <td className="text-col">{row.item_name}</td>
                      <td>{row.brand || "—"}</td>
                      <td className="text-col">{row.slot_label || "—"}</td>
                      <td className="nw">{RESULT[row.state]}</td>
                      <td className="num nw">{row.applied_qty === null ? "" : num(row.applied_qty)}</td>
                      <td className="nw">{row.decided_by_name ?? ""}</td>
                      <td className="nw">
                        {row.state !== "stocked" && (
                          <>
                            <SlotSelect slots={slots} value={choice[row.material_id] ?? row.stock_id} onChange={(id) => setChoice({ ...choice, [row.material_id]: id })} />
                            <button className="link" disabled={busy || (choice[row.material_id] ?? row.stock_id) === null} onClick={() => decide(row, "confirm")}>归入</button>
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {data && !rows.length && (
              <tr><td colSpan={9} className="muted">
                {view === "pending" ? "没有待确认的采购记录。新采购同步后点「匹配采购记录」。" : view === "inbound" ? "没有待入库的采购。槽位完成第一次核对（基线）后，之后的采购才会出现在这里。" : "还没有处理记录。"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
