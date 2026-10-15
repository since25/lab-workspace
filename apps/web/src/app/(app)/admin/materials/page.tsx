"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errText } from "@/lib/client";

interface Item {
  id: number; item_name: string; brand: string; spec_model: string; material_code: string;
  request_no: string; department: string; requested_by: string | null; used_up_requested_at: string;
}
interface Resp { items: Item[]; total: number; page: number; page_size: number }

export default function MaterialRequestsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await api<Resp>(`/api/v1/admin/materials/usage-requests?page=${page}`));
      setSelected([]);
      setError("");
    } catch (e) { setError(errText(e)); }
  }, [page]);
  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function review(action: "approve" | "reject") {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ done: number; skipped: number }>("/api/v1/admin/materials/usage-requests", {
        method: "POST", body: JSON.stringify({ ids: selected, action }),
      });
      setNotice(`已${action === "approve" ? "批准" : "驳回"} ${result.done} 条申请${result.skipped ? `，${result.skipped} 条状态已变化` : ""}。`);
      await load();
    } catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  }
  const allSelected = !!data?.items.length && data.items.every(m => selected.includes(m.id));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return <>
    <h1>物料已用完审批</h1>
    <p className="muted">普通成员提交的申请在批准前仍显示于物料清单；批准后默认隐藏，管理员可在已用完列表恢复。</p>
    <div className="toolbar">
      <Link href="/materials">返回部门物料</Link>
      <span className="spacer" />
      <button className="primary" disabled={!selected.length || busy} onClick={() => review("approve")}>批准所选（{selected.length}）</button>
      <button disabled={!selected.length || busy} onClick={() => review("reject")}>驳回所选</button>
    </div>
    {error && <div className="error">{error}</div>}
    {notice && <p role="status">{notice}</p>}
    <div className="table-wrap"><table>
      <thead><tr>
        <th><input type="checkbox" style={{ minHeight: 0 }} aria-label="选择本页全部申请" disabled={busy || !data?.items.length} checked={allSelected}
          onChange={e => setSelected(e.target.checked ? data?.items.map(m => m.id) ?? [] : [])} /></th>
        <th>物料</th><th>部门</th><th>采购单 / 物料编码</th><th>申请人</th><th>申请时间</th>
      </tr></thead>
      <tbody>
        {data?.items.map(m => <tr key={m.id}>
          <td><input type="checkbox" style={{ minHeight: 0 }} aria-label={`选择 ${m.item_name}`} disabled={busy} checked={selected.includes(m.id)}
            onChange={e => setSelected(prev => e.target.checked ? [...prev, m.id] : prev.filter(id => id !== m.id))} /></td>
          <td className="text-col">{m.item_name}<div className="muted">{m.brand} {m.spec_model}</div></td>
          <td>{m.department}</td><td>{m.request_no}<div className="muted">{m.material_code}</div></td>
          <td>{m.requested_by || "账号已删除"}</td><td className="nw">{new Date(m.used_up_requested_at).toLocaleString("zh-CN")}</td>
        </tr>)}
        {data && !data.items.length && <tr><td colSpan={6} className="muted">没有待批准的申请</td></tr>}
      </tbody>
    </table></div>
    {data && <div className="pager">
      <button disabled={data.page <= 1 || busy} onClick={() => setPage(data.page - 1)}>上一页</button>
      <span className="muted">第 {data.page} / {pages} 页，共 {data.total} 条</span>
      <button disabled={data.page >= pages || busy} onClick={() => setPage(data.page + 1)}>下一页</button>
    </div>}
  </>;
}
