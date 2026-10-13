"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errText } from "@/lib/client";
import Combobox from "../Combobox";
import ImportBox from "../ImportBox";
import SortTh, { type Sort } from "../SortTh";

interface Asset {
  id: number;
  asset_name: string;
  spec_model: string;
  category: string;
  quantity: string | null;
  location: string;
  department: string;
  user_name: string;
}
interface Resp {
  items: Asset[];
  total: number;
  page: number;
  page_size: number;
  facets: { category: string[]; location: string[] };
  last_import: { filename: string; created_at: string; accepted_count: number } | null;
}

export default function AssetsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [f, setF] = useState({ q: "", user: "", category: "", location: "", page: 1 });
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
      setData(await api<Resp>(`/api/v1/assets?${sp}`));
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
      <h1>固定资产</h1>
      <p className="muted">
        研发部固定资产台账，只读查询。
        {data?.last_import && <> 最近更新：{new Date(data.last_import.created_at).toLocaleString("zh-CN")}（{data.last_import.accepted_count} 条）。</>}
      </p>
      <div className="toolbar">
        <label className="field">
          搜索
          <input style={{ width: 220 }} placeholder="资产名称 / 规格型号" value={f.q} onChange={upd("q")} />
        </label>
        <label className="field">
          使用人
          <input value={f.user} onChange={upd("user")} />
        </label>
        <label className="field">
          类别
          <Combobox value={f.category} allowEmpty options={data?.facets.category ?? []} onChange={pick("category")} />
        </label>
        <label className="field">
          存放地点
          <Combobox value={f.location} allowEmpty options={data?.facets.location ?? []} onChange={pick("location")} />
        </label>
        <span className="spacer" />
        {isAdmin && <button onClick={() => setShowImport(!showImport)}>导入台账（整表替换）</button>}
      </div>

      {showImport && (
        <ImportBox
          endpoint="/api/v1/assets/import"
          hint="上传《固定资产台账》.xlsx。系统读取所有含「固定资产名称」「使用部门」表头的工作表（名为 Sheet1、Sheet3 这类的草稿表不读），只导入使用部门为研发部的资产；同一资产编号在多个表出现时只导入一次。确认后整体替换现有数据。"
          confirmText="确认替换"
          onDone={() => { setShowImport(false); load(); }}
          renderPreview={(d) => (
            <p>
              解析到研发部资产 {String(d.total)} 条（
              {(d.sheets_used as { sheet: string; rows: number }[]).map((s) => `${s.sheet} ${s.rows} 条`).join("，")}
              ），确认后将替换现有的 {data?.total ?? 0} 条。
            </p>
          )}
        />
      )}
      {error && <div className="error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {th("asset_name", "资产名称")}{th("spec_model", "规格型号")}{th("category", "类别")}{th("quantity", "数量")}
              {th("location", "存放地点")}<th>使用部门</th>{th("user_name", "使用人")}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((a) => (
              <tr key={a.id}>
                <td className="text-col">{a.asset_name}</td>
                <td className="mono code-col">{a.spec_model}</td>
                <td className="nw">{a.category}</td>
                <td className="num nw">{a.quantity === null ? "" : Number(a.quantity)}</td>
                <td className="nw">{a.location}</td>
                <td className="nw">{a.department}</td>
                <td className="nw">{a.user_name}</td>
              </tr>
            ))}
            {data && !data.items.length && <tr><td colSpan={7} className="muted">没有符合条件的记录</td></tr>}
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
