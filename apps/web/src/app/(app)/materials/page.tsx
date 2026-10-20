"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, errText } from "@/lib/client";
import Combobox from "../Combobox";
import ImportBox from "../ImportBox";
import SortTh, { type Sort } from "../SortTh";

interface Item {
  id: number;
  requested_on: string | null;
  requester: string;
  material_code: string;
  status: string;
  minor_category: string;
  item_name: string;
  brand: string;
  spec_model: string;
  unit: string;
  quantity: string | null;
  project_code: string;
  remarks: string;
  receipt_status: string;
  last_received_on: string | null;
  received_qty: string | null;
  is_used_up: boolean;
  used_up_requested_at: string | null;
}
interface Resp {
  items: Item[];
  total: number;
  page: number;
  page_size: number;
  departments: string[];
  pending_count: number;
  facets: { category: string[]; status: string[]; receipt: string[]; brand: string[]; requester: string[] };
  last_import: { filename: string; created_at: string; accepted_count: number } | null;
}

const num = (v: string | null) => (v === null ? "" : String(Number(v)));

export default function MaterialsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [f, setF] = useState({ q: "", brand: "", requester: "", category: "", status: "", receipt: "", used_up: "", page: 1 });
  const [sort, setSort] = useState<Sort>({ key: "", dir: "asc" });
  const [isAdmin, setIsAdmin] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    const sp = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== "").map(([k, v]) => [k, String(v)]));
    if (sort.key) {
      sp.set("sort", sort.key);
      sp.set("dir", sort.dir);
    }
    try {
      setData(await api<Resp>(`/api/v1/materials?${sp}`, { signal }));
      setError("");
    } catch (e) {
      if (!signal.aborted) setError(errText(e));
    }
  }, [f, sort]);

  useEffect(() => {
    api<{ user: { role: string } }>("/api/v1/auth/me").then((d) => setIsAdmin(d.user.role === "admin"), () => {});
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(() => load(controller.signal), 200);
    return () => { clearTimeout(t); controller.abort(); };
  }, [load, refresh]);

  const upd = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value, page: 1 });
  const pick = (k: string) => (v: string) => setF({ ...f, [k]: v, page: 1 });
  const th = (k: string, label: string) => <SortTh k={k} label={label} sort={sort} onSort={(x) => { setSort(x); setF({ ...f, page: 1 }); }} />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  async function changeUsage(m: Item, action: "mark" | "restore") {
    if (!isAdmin && !window.confirm(`确认申请将「${m.item_name}」标记为已用完？管理员批准前仍会显示。`)) return;
    setBusy(m.id);
    setError("");
    try {
      const result = await api<{ pending: boolean; done: number }>(`/api/v1/materials/${m.id}/usage`, {
        method: "POST", body: JSON.stringify({ action, confirmed: true }),
      });
      setNotice(result.done ? result.pending ? "已提交申请，等待管理员批准。" : action === "restore" ? "已恢复显示。" : "已标记为已用完。" : "该记录状态已变化，请查看刷新后的列表。");
      setRefresh(v => v + 1);
    } catch (e) { setError(errText(e)); }
    finally { setBusy(null); }
  }

  return (
    <>
      <h1>部门物料</h1>
      <p className="muted">
        数据来自采购系统「请购物料库」导出，用于查询买过什么、品牌货号、请购人和到货情况；不含存放位置和剩余库存。
        剩余库存与核对见顶部「常用耗材」选项卡。
        {data && <> 展示部门：{data.departments.join("、") || "尚未设置，请联系管理员"}。</>}
        {data?.last_import && <> 最近更新：{new Date(data.last_import.created_at).toLocaleString("zh-CN")}（{data.last_import.accepted_count} 条）。</>}
      </p>
      <div className="toolbar">
        <label className="field">
          搜索
          <input style={{ width: 240 }} placeholder="名称 / 货号 / 物料编码 / 项目" value={f.q} onChange={upd("q")} />
        </label>
        <label className="field">
          品牌
          <Combobox value={f.brand} allowEmpty options={data?.facets.brand ?? []} onChange={pick("brand")} />
        </label>
        <label className="field">
          请购人
          <Combobox value={f.requester} allowEmpty options={data?.facets.requester ?? []} onChange={pick("requester")} style={{ minWidth: 110 }} />
        </label>
        <label className="field">
          小类
          <Combobox value={f.category} allowEmpty options={data?.facets.category ?? []} onChange={pick("category")} />
        </label>
        <label className="field">
          状态
          <Combobox value={f.status} allowEmpty options={data?.facets.status ?? []} onChange={pick("status")} style={{ minWidth: 100 }} />
        </label>
        <label className="field">
          收货
          <Combobox value={f.receipt} allowEmpty options={data?.facets.receipt ?? []} onChange={pick("receipt")} style={{ minWidth: 110 }} />
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" style={{ minHeight: 0 }} checked={f.used_up === "1"}
            onChange={(e) => { setF(prev => ({ ...prev, used_up: e.target.checked ? "1" : "", brand: "", requester: "", category: "", status: "", receipt: "", page: 1 })); setNotice(""); }} />
          仅显示已用完物料
        </label>
        <span className="spacer" />
        {isAdmin && <Link href="/admin/materials">已用完审批（{data?.pending_count ?? 0}）</Link>}
        {isAdmin && <button onClick={() => setShowImport(!showImport)}>导入采购导出（增量更新）</button>}
      </div>

      {showImport && (
        <ImportBox
          endpoint="/api/v1/materials/import"
          hint="上传采购系统导出的 .xlsx 或 .csv。新增采购记录、更新已有采购信息，保留已用完标记及待审批申请；不会删除旧记录。"
          confirmText="确认增量更新"
          onDone={() => { setShowImport(false); setRefresh(v => v + 1); }}
          renderPreview={(d) => (
            <p>解析到 {String(d.total)} 条采购记录，将按采购单编码和物料编码匹配，新增或更新；已用完标记和待审批申请保持不变。</p>
          )}
        />
      )}
      {error && <div className="error">{error}</div>}
      {notice && <p role="status">{notice}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {th("requested_on", "请购日期")}{th("item_name", "名称")}{th("brand", "品牌")}{th("spec_model", "规格型号")}
              {th("quantity", "数量")}{th("minor_category", "小类")}{th("project_code", "项目")}{th("requester", "请购人")}
              {th("receipt_status", "收货")}{th("material_code", "物料编码")}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((m) => (
              <tr key={m.id}>
                <td className="nw">{m.requested_on}</td>
                <td className="text-col">
                  {m.item_name}
                  {m.status !== "启用" && <> <span className="flag">{m.status}</span></>}
                  {m.remarks && <div className="muted">{m.remarks}</div>}
                </td>
                <td className="brand-col">{m.brand}</td>
                <td className="mono code-col">{m.spec_model}</td>
                <td className="num nw">{num(m.quantity)} {m.unit}</td>
                <td className="nw">{m.minor_category}</td>
                <td className="nw">{m.project_code}</td>
                <td className="nw">{m.requester}</td>
                <td className="nw">
                  {m.receipt_status}
                  {m.last_received_on && <div className="muted">{m.last_received_on}</div>}
                </td>
                <td className="nw">
                  <div className="mono">{m.material_code}</div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    {m.used_up_requested_at && !m.is_used_up && <div>已申请用完，待管理员批准</div>}
                    {m.is_used_up ? isAdmin && <button className="link" style={{ color: "inherit", padding: 0 }} disabled={busy !== null} onClick={() => changeUsage(m, "restore")}>恢复显示</button>
                      : (isAdmin || !m.used_up_requested_at) && <button className="link" style={{ color: "inherit", padding: 0 }} disabled={busy !== null} onClick={() => changeUsage(m, "mark")}>{isAdmin ? "标记已用完" : "申请已用完"}</button>}
                  </div>
                </td>
              </tr>
            ))}
            {data && !data.items.length && (
              <tr><td colSpan={10} className="muted">没有符合条件的记录</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data && (
        <div className="pager">
          <button disabled={data.page <= 1} onClick={() => setF({ ...f, page: data.page - 1 })}>上一页</button>
          <span className="muted">第 {data.page} / {pages} 页，共 {data.total} 条</span>
          <button disabled={data.page >= pages} onClick={() => setF({ ...f, page: data.page + 1 })}>下一页</button>
        </div>
      )}
    </>
  );
}
