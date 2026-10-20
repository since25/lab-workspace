"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { api, errText } from "@/lib/client";
import Combobox from "../Combobox";
import ImportBox from "../ImportBox";
import SortTh, { type Sort } from "../SortTh";

interface AssetItem {
  id: number;
  asset_code: string;
  asset_code_new: string;
  asset_name: string;
  spec_model: string;
  category: string;
  quantity: string | null;
  location: string;
  department: string;
  user_name: string;
}
interface AssetLocation {
  location: string;
  item_count: number;
  total_quantity: string | null;
}
interface AssetGroup {
  asset_name: string;
  spec_model: string;
  department: string;
  category: string | null;
  user_names: string | null;
  item_count: number;
  total_quantity: string | null;
  location_count: number;
  locations: AssetLocation[];
}
interface Resp {
  view: "group" | "item";
  groups?: AssetGroup[];
  items?: AssetItem[];
  // 展示范围（后台配置的部门，空数组表示不限部门）
  departments: string[];
  total: number;
  page: number;
  page_size: number;
  facets: { category: string[]; location: string[]; department: string[] };
  last_import: { filename: string; created_at: string; accepted_count: number } | null;
  // 台账全量条数（所有部门），用于导入确认前提示会被替换的规模
  total_rows: number;
}

type View = "group" | "item";
const groupKey = (name: string, spec: string, department: string) => `${name}\u0000${spec}\u0000${department}`;
// 展示用编号：台账里新编号（CMC-…）比旧编号（ZX-…）更常用，缺新编号时退回旧编号
const primaryCode = (a: { asset_code: string; asset_code_new: string }) => a.asset_code_new || a.asset_code;

export default function AssetsPage() {
  const [view, setView] = useState<View>("group");
  const [data, setData] = useState<Resp | null>(null);
  const [f, setF] = useState({ q: "", user: "", category: "", location: "", department: "", page: 1 });
  const [sort, setSort] = useState<Sort>({ key: "", dir: "asc" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, AssetItem[]>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState("");

  // 当前筛选（不含视图与分页），汇总视图与展开明细共用，保证地点条数和明细内容一致
  const filterParams = useCallback(() => {
    const sp = new URLSearchParams(Object.entries(f).filter(([k, v]) => k !== "page" && v !== "").map(([k, v]) => [k, String(v)]));
    return sp;
  }, [f]);

  const load = useCallback(async () => {
    const sp = filterParams();
    sp.set("view", view);
    sp.set("page", String(f.page));
    if (sort.key) {
      sp.set("sort", sort.key);
      sp.set("dir", sort.dir);
    }
    try {
      setData(await api<Resp>(`/api/v1/assets?${sp}`));
      setError("");
    } catch (e) {
      setError(errText(e));
    }
  }, [f.page, filterParams, sort, view]);

  useEffect(() => {
    api<{ user: { role: string } }>("/api/v1/auth/me").then((d) => setIsAdmin(d.user.role === "admin"), () => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);
  const clearExpanded = () => { setExpanded(new Set()); setDetails({}); };
  const upd = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { setF({ ...f, [k]: e.target.value, page: 1 }); clearExpanded(); };
  const pick = (k: string) => (v: string) => { setF({ ...f, [k]: v, page: 1 }); clearExpanded(); };
  const goPage = (page: number) => { setF({ ...f, page }); clearExpanded(); };
  const th = (k: string, label: string) => <SortTh k={k} label={label} sort={sort} onSort={(x) => { setSort(x); setF({ ...f, page: 1 }); }} />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const isGroup = view === "group";
  // 展示范围只有一个部门时，部门筛选和部门列都是多余的
  const multiDept = !!data && data.departments.length !== 1;
  const showDeptCol = isGroup && multiDept && !f.department;
  const groupCols = showDeptCol ? 8 : 7;
  const scopeText = !data
    ? "固定资产台账"
    : data.departments.length ? `${data.departments.join("、")}固定资产台账` : "全部部门的固定资产台账";

  function switchView(next: View) {
    if (next === view) return;
    setView(next);
    setSort({ key: "", dir: "asc" });
    setF({ ...f, page: 1 });
    clearExpanded();
  }

  // 按当前筛选定位某个存放地点：再次点击同一个地点则取消筛选
  function pickLocation(location: string) {
    setF({ ...f, location: f.location === location ? "" : location, page: 1 });
    clearExpanded();
  }

  async function toggleGroup(g: AssetGroup) {
    const k = groupKey(g.asset_name, g.spec_model, g.department);
    const open = !expanded.has(k);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(k);
      else next.delete(k);
      return next;
    });
    if (!open || details[k]) return;
    const sp = filterParams();
    sp.set("view", "detail");
    sp.set("name", g.asset_name);
    sp.set("spec", g.spec_model);
    sp.set("group_department", g.department);
    try {
      const d = await api<{ items: AssetItem[] }>(`/api/v1/assets?${sp}`);
      setDetails((prev) => ({ ...prev, [k]: d.items }));
    } catch (e) {
      setDetails((prev) => ({ ...prev, [k]: [] }));
      setError(errText(e));
    }
  }

  // 明细行里的资产编号：新编号为主，两套编号都存在时把旧编号放在下面，方便对旧台账
  const codeCell = (a: AssetItem) => (
    <>
      <span className="mono">{primaryCode(a) || <span className="muted">无编号</span>}</span>
      {a.asset_code_new && a.asset_code && a.asset_code_new !== a.asset_code && (
        <div className="muted mono code-old">{a.asset_code}</div>
      )}
    </>
  );

  return (
    <>
      <h1>固定资产</h1>
      <p className="muted">
        {scopeText}，{isGroup ? "按「资产名称＋规格型号」汇总，同名同规格只占一行，点开可看每个存放地点的资产编号。" : "逐条明细，一行一条资产。"}
        {data?.last_import && <> 最近更新：{new Date(data.last_import.created_at).toLocaleString("zh-CN")}（{data.last_import.accepted_count} 条）。</>}
      </p>
      <div className="toolbar">
        <span className="seg" role="tablist" aria-label="视图">
          <button role="tab" aria-selected={isGroup} className={isGroup ? "active" : ""} onClick={() => switchView("group")}>按物品汇总</button>
          <button role="tab" aria-selected={!isGroup} className={!isGroup ? "active" : ""} onClick={() => switchView("item")}>逐条明细</button>
        </span>
        <label className="field">
          搜索
          <input style={{ width: 220 }} placeholder="资产名称 / 规格型号 / 资产编号" value={f.q} onChange={upd("q")} />
        </label>
        {multiDept && (
          <label className="field">
            使用部门
            <Combobox value={f.department} allowEmpty options={data?.facets.department ?? []} onChange={pick("department")} />
          </label>
        )}
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
          hint="上传《固定资产台账》.xlsx。系统读取所有含「固定资产名称」「使用部门」表头的工作表（名为 Sheet1、Sheet3 这类的草稿表不读），台账里所有部门的资产都整表入库；资产编号（含新编号）用于跨表去重并随行保留。确认后整体替换现有数据。"
          confirmText="确认替换"
          onDone={() => { setShowImport(false); load(); }}
          renderPreview={(d) => (
            <>
              <p>
                解析到资产 {String(d.total)} 条（
                {(d.sheets_used as { sheet: string; rows: number }[]).map((s) => `${s.sheet} ${s.rows} 条`).join("，")}
                ），确认后将整体替换现有台账（{data?.total_rows ?? 0} 条）。
              </p>
              <p className="muted">
                按部门：{(d.departments as { department: string; rows: number }[]).map((x) => `${x.department} ${x.rows} 条`).join("，")}
              </p>
            </>
          )}
        />
      )}
      {error && <div className="error">{error}</div>}

      <div className="table-wrap">
        {isGroup ? (
          <table>
            <thead>
              <tr>
                <th className="nw" aria-label="展开" />
                {th("asset_name", "资产名称")}{th("spec_model", "规格型号")}
                {showDeptCol && th("department", "使用部门")}
                {th("category", "类别")}{th("item_count", "条目数")}
                <th>存放地点</th><th>使用人</th>
              </tr>
            </thead>
            <tbody>
              {data?.groups?.map((g) => {
                const k = groupKey(g.asset_name, g.spec_model, g.department);
                const open = expanded.has(k);
                const rows = details[k];
                return (
                  <Fragment key={k}>
                    <tr className="group-row" onClick={() => toggleGroup(g)}>
                      <td className="nw">
                        <button
                          className="row-toggle"
                          aria-expanded={open}
                          aria-label={`${open ? "收起" : "展开"} ${g.asset_name} 的明细`}
                          onClick={(e) => { e.stopPropagation(); toggleGroup(g); }}
                        >
                          {open ? "▾" : "▸"}
                        </button>
                      </td>
                      <td className="text-col">{g.asset_name}</td>
                      <td className="mono code-col">{g.spec_model}</td>
                      {showDeptCol && <td className="nw">{g.department}</td>}
                      <td className="nw">{g.category}</td>
                      <td className="num nw">
                        {g.item_count}
                        {Number(g.total_quantity) !== g.item_count && Number(g.total_quantity) > 0 && (
                          <span className="muted"> / {Number(g.total_quantity)}</span>
                        )}
                      </td>
                      <td>
                        <span className="loc-chips">
                          {g.locations.map((l) => (
                            <button
                              key={l.location || "(空)"}
                              className={`loc-chip${f.location === l.location ? " selected" : ""}`}
                              title={`只看存放地点 ${l.location || "（未填）"}`}
                              onClick={(e) => { e.stopPropagation(); pickLocation(l.location); }}
                            >
                              {l.location || "（未填）"}<span className="times">×{l.item_count}</span>
                            </button>
                          ))}
                        </span>
                      </td>
                      <td className="nw text-col">{g.user_names}</td>
                    </tr>
                    {open && (
                      <tr className="subtable-row">
                        <td colSpan={groupCols}>
                          {rows ? (
                            <table className="subtable">
                              <thead>
                                <tr><th>资产编号</th><th>存放地点</th><th>使用人</th><th>使用部门</th><th>类别</th><th>数量</th></tr>
                              </thead>
                              <tbody>
                                {rows.map((a) => (
                                  <tr key={a.id}>
                                    <td className="code-col">{codeCell(a)}</td>
                                    <td className="nw">{a.location}</td>
                                    <td className="nw">{a.user_name}</td>
                                    <td className="nw">{a.department}</td>
                                    <td className="nw">{a.category}</td>
                                    <td className="num nw">{a.quantity === null ? "" : Number(a.quantity)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="muted" style={{ margin: "4px 0" }}>加载中…</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {data?.groups && !data.groups.length && <tr><td colSpan={groupCols} className="muted">没有符合条件的记录</td></tr>}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                {th("asset_name", "资产名称")}{th("spec_model", "规格型号")}{th("asset_code_new", "资产编号")}{th("category", "类别")}
                {th("quantity", "数量")}{th("location", "存放地点")}{th("department", "使用部门")}{th("user_name", "使用人")}
              </tr>
            </thead>
            <tbody>
              {data?.items?.map((a) => (
                <tr key={a.id}>
                  <td className="text-col">{a.asset_name}</td>
                  <td className="mono code-col">{a.spec_model}</td>
                  <td className="code-col">{codeCell(a)}</td>
                  <td className="nw">{a.category}</td>
                  <td className="num nw">{a.quantity === null ? "" : Number(a.quantity)}</td>
                  <td className="nw">{a.location}</td>
                  <td className="nw">{a.department}</td>
                  <td className="nw">{a.user_name}</td>
                </tr>
              ))}
              {data?.items && !data.items.length && <tr><td colSpan={8} className="muted">没有符合条件的记录</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {data && (
        <div className="pager">
          <button disabled={f.page <= 1} onClick={() => goPage(f.page - 1)}>上一页</button>
          <span className="muted">
            第 {data.page} / {pages} 页，共 {data.total} {isGroup ? "种物品" : "条"}
          </span>
          <button disabled={f.page >= pages} onClick={() => goPage(f.page + 1)}>下一页</button>
        </div>
      )}
    </>
  );
}
