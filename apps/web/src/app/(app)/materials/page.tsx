"use client";

import { useCallback, useEffect, useState } from "react";
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
}
interface Resp {
  items: Item[];
  total: number;
  page: number;
  page_size: number;
  facets: { category: string[]; status: string[]; receipt: string[]; brand: string[]; requester: string[] };
  last_import: { filename: string; created_at: string; accepted_count: number } | null;
}

const num = (v: string | null) => (v === null ? "" : String(Number(v)));

export default function MaterialsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [f, setF] = useState({ q: "", brand: "", requester: "", category: "", status: "", receipt: "", page: 1 });
  const [sort, setSort] = useState<Sort>({ key: "", dir: "asc" });
  const [isAdmin, setIsAdmin] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const sp = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== "").map(([k, v]) => [k, String(v)]));
    if (sort.key) {
      sp.set("sort", sort.key);
      sp.set("dir", sort.dir);
    }
    try {
      setData(await api<Resp>(`/api/v1/materials?${sp}`));
    } catch (e) {
      setError(errText(e));
    }
  }, [f, sort]);

  useEffect(() => {
    api<{ user: { role: string } }>("/api/v1/auth/me").then((d) => setIsAdmin(d.user.role === "admin"), () => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const upd = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value, page: 1 });
  const pick = (k: string) => (v: string) => setF({ ...f, [k]: v, page: 1 });
  const th = (k: string, label: string) => <SortTh k={k} label={label} sort={sort} onSort={(x) => { setSort(x); setF({ ...f, page: 1 }); }} />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <>
      <h1>部门物料</h1>
      <p className="muted">
        数据来自采购系统「请购物料库」导出，用于查询买过什么、品牌货号、请购人和到货情况；不含存放位置和剩余库存。
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
        <span className="spacer" />
        {isAdmin && <button onClick={() => setShowImport(!showImport)}>导入采购导出（整表替换）</button>}
      </div>

      {showImport && (
        <ImportBox
          endpoint="/api/v1/materials/import"
          hint="上传采购系统「请购物料库」导出的 .xlsx。确认后会用新文件整体替换现有物料数据；导入失败时保留旧数据。"
          confirmText="确认替换"
          onDone={() => { setShowImport(false); load(); }}
          renderPreview={(d) => (
            <p>解析到 {String(d.total)} 条采购记录，确认后将替换现有的 {data?.total ?? 0} 条。</p>
          )}
        />
      )}
      {error && <div className="error">{error}</div>}

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
                <td className="mono nw">{m.material_code}</td>
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
          <button disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>上一页</button>
          <span className="muted">第 {data.page} / {pages} 页，共 {data.total} 条</span>
          <button disabled={f.page >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}>下一页</button>
        </div>
      )}
    </>
  );
}
