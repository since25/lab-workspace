"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errText } from "@/lib/client";

interface Material {
  id: number;
  item_name: string;
  brand: string;
  spec_model: string;
  material_code: string;
  request_no: string;
  department: string;
  requested_on: string | null;
  last_received_on: string | null;
  receipt_status: string;
  purchased_qty: number | null;
  received_qty: number | null;
  is_used_up: boolean;
  used_up_requested_at: string | null;
}

interface Request {
  id: number;
  stock_id: number | null;
  stock_label: string;
  stock_before: number | null;
  stock_revision: number | null;
  proposed_quantity: number | null;
  material_ids: number[];
  note: string;
  status: "pending" | "approved" | "rejected";
  requested_by_name: string | null;
  requested_at: string;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string;
  current_quantity: number | null;
  current_revision: number | null;
  stock_changed: boolean;
  materials: Material[];
}

interface Resp { items: Request[]; total: number; page: number; page_size: number }

const STATUS_LABEL = { pending: "待审批", approved: "已批准", rejected: "已驳回" } as const;
const num = (v: number | null) => (v === null ? "—" : String(Number(v)));
const when = (v: string | null) => (v ? new Date(v).toLocaleString("zh-CN") : "—");

export default function AdminReconcilePage() {
  const [data, setData] = useState<Resp | null>(null);
  const [status, setStatus] = useState<"pending" | "all" | "approved" | "rejected">("pending");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<Resp>(`/api/v1/admin/materials/reconcile?status=${status}&page=${page}`));
      setError("");
    } catch (e) { setError(errText(e)); }
  }, [status, page]);
  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function review(item: Request, action: "approve" | "reject") {
    let note = "";
    if (action === "approve") {
      const parts = [];
      if (item.proposed_quantity !== null) parts.push(`库存 ${num(item.stock_before)} → ${num(item.proposed_quantity)}`);
      if (item.material_ids.length) parts.push(`${item.material_ids.length} 条采购记录标记为已用完`);
      if (!window.confirm(`确认批准请求 #${item.id}？${parts.length ? `将${parts.join("，")}。` : ""}`)) return;
    } else {
      const input = window.prompt(`驳回请求 #${item.id}，可填写原因：`, "");
      if (input === null) return;
      note = input.trim();
    }
    setBusy(item.id);
    setError("");
    try {
      const result = await api<{ approved: number; rejected: number; skipped: number }>("/api/v1/admin/materials/reconcile", {
        method: "POST", body: JSON.stringify({ ids: [item.id], action, note }),
      });
      setNotice(action === "approve" ? "已批准，库存和采购记录已更新。" : "已驳回。");
      if (result.skipped) setNotice("请求状态已变化，已刷新列表。");
      await load();
    } catch (e) { setError(errText(e)); }
    finally { setBusy(null); }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const tab = (value: typeof status, label: string) => (
    <button className={status === value ? "active" : ""} onClick={() => { setStatus(value); setPage(1); }}>{label}</button>
  );

  return (
    <>
      <h1>库存校对请求</h1>
      <p className="muted">
        成员或 agent 提交的库存校对会同时包含库存数量建议和需要标记为已用完的采购记录。批准后在一个事务里更新库存并写核对历史；
        提交后库存被其他人改过、或耗材条目已删除时，请求会提示重新核对，需驳回后重提。
      </p>
      <div className="toolbar">
        <Link href="/admin/materials">← 已用完审批</Link>
        <Link href="/materials">部门物料</Link>
        <Link href="/materials/stock">常用耗材</Link>
      </div>
      <div className="tabs">
        {tab("pending", "待审批")}{tab("all", "全部")}{tab("approved", "已批准")}{tab("rejected", "已驳回")}
      </div>
      {error && <div className="error">{error}</div>}
      {notice && <p role="status">{notice}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>提交</th><th>耗材与建议</th><th>采购记录</th><th>说明</th><th>状态 / 审批</th><th>操作</th></tr>
          </thead>
          <tbody>
            {data?.items.map((item) => (
              <tr key={item.id}>
                <td className="nw">
                  #{item.id}
                  <div className="muted">{item.requested_by_name || "账号已删除"}</div>
                  <div className="muted">{when(item.requested_at)}</div>
                </td>
                <td className="text-col">
                  {item.stock_label || "仅采购记录"}
                  {item.proposed_quantity !== null ? (
                    <div>
                      提交时 {num(item.stock_before)} → 建议 <strong>{num(item.proposed_quantity)}</strong>
                    </div>
                  ) : (
                    <div className="muted">不改库存数量</div>
                  )}
                  {item.stock_id && (
                    <div className="muted">
                      当前 {num(item.current_quantity)}
                      {item.stock_changed && <span className="stock-status stock-out" style={{ marginLeft: 6 }}>库存已变化，请驳回</span>}
                    </div>
                  )}
                </td>
                <td>
                  {item.materials.length ? (
                    <details>
                      <summary>{item.materials.length} 条采购记录</summary>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                        {item.materials.map((m) => (
                          <li key={m.id}>
                            {m.item_name}
                            <span className="muted"> · {m.request_no} · {m.requested_on || "无日期"} · {m.receipt_status || "无收货状态"}</span>
                            {m.is_used_up && <span className="flag" style={{ marginLeft: 6 }}>已用完</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : <span className="muted">未选择</span>}
                </td>
                <td className="text-col">{item.note}</td>
                <td className="nw">
                  <span className={`stock-status ${item.status === "pending" ? "stock-low" : item.status === "approved" ? "stock-ok" : "stock-out"}`}>
                    {STATUS_LABEL[item.status]}
                  </span>
                  {item.reviewed_by_name && <div className="muted">{item.reviewed_by_name} · {when(item.reviewed_at)}</div>}
                  {item.review_note && <div className="muted">{item.review_note}</div>}
                </td>
                <td className="actions">
                  {item.status === "pending" ? (
                    <>
                      <button
                        className="primary"
                        disabled={busy !== null || item.stock_changed}
                        title={item.stock_changed ? "库存已变化，请驳回后重新提交" : ""}
                        onClick={() => review(item, "approve")}
                      >批准</button>
                      <button disabled={busy !== null} onClick={() => review(item, "reject")}>驳回</button>
                    </>
                  ) : <span className="muted">已处理</span>}
                </td>
              </tr>
            ))}
            {data && !data.items.length && (
              <tr><td colSpan={6} className="muted">{status === "pending" ? "没有待审批的库存校对请求" : "没有符合条件的请求"}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data && (
        <div className="pager">
          <button disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>上一页</button>
          <span className="muted">第 {data.page} / {pages} 页，共 {data.total} 条</span>
          <button disabled={data.page >= pages} onClick={() => setPage(data.page + 1)}>下一页</button>
        </div>
      )}
    </>
  );
}
