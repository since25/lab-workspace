"use client";

import { useCallback, useEffect, useState } from "react";
import { api, download, errText } from "@/lib/client";
import Combobox from "../Combobox";
import ImportBox from "../ImportBox";
import SuggestInput from "../SuggestInput";

interface Cell {
  id: number;
  rack_no: number;
  layer_no: number;
  cell_name: string;
  source: string;
  passage: string;
  density: string;
  freezing_medium: string;
  tube_count: number | null;
  tube_count_raw: string;
  depositor: string;
  frozen_on: string | null;
  frozen_on_raw: string;
  needs_review: boolean;
  review_reason: string;
  remarks: string;
}
interface HistoryItem {
  id: number;
  action: string;
  actor: string | null;
  created_at: string;
  metadata_json: { changes?: Record<string, [unknown, unknown]>; snapshot?: unknown };
}

const LABELS: Record<string, string> = {
  rack_no: "架号", layer_no: "层", cell_name: "细胞名称", source: "来源", passage: "代次", density: "细胞密度",
  freezing_medium: "冻存液", tube_count: "管数", depositor: "存放人", frozen_on: "放入时间", remarks: "备注", needs_review: "待核对",
};
const RACKS = [1, 2, 3, 4, 5, 6];
const CN = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const EMPTY = { rack_no: "", layer_no: "", cell_name: "", source: "", passage: "", density: "", freezing_medium: "", tube_count: "", depositor: "", frozen_on: "", remarks: "", needs_review: false };
type Form = typeof EMPTY;
// 下拉候选（台账里已有的值）
type Options = Record<"cell_name" | "source" | "freezing_medium" | "depositor", string[]>;
const NO_OPTIONS: Options = { cell_name: [], source: [], freezing_medium: [], depositor: [] };

export default function CellsClient({ initialReview }: { initialReview: boolean }) {
  const [cells, setCells] = useState<Cell[]>([]);
  const [stats, setStats] = useState({ total: 0, review: 0, racks: [] as number[] });
  const [filter, setFilter] = useState({ rack: "", layer: "", q: "", source: "", depositor: "", medium: "", review: initialReview });
  const [options, setOptions] = useState<Options>(NO_OPTIONS);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isAdmin, setIsAdmin] = useState(false);
  const [editing, setEditing] = useState<Cell | "new" | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState("");

  const filterParams = useCallback(() => {
    const sp = new URLSearchParams();
    for (const k of ["rack", "layer", "q", "source", "depositor", "medium"] as const) {
      if (filter[k]) sp.set(k, filter[k]);
    }
    if (filter.review) sp.set("review", "1");
    return sp;
  }, [filter]);

  const load = useCallback(async () => {
    try {
      const d = await api<{ cells: Cell[]; stats: typeof stats; options: Options }>(`/api/v1/cells?${filterParams()}`);
      setCells(d.cells);
      setStats(d.stats);
      setOptions(d.options);
    } catch (e) {
      setError(errText(e));
    }
  }, [filterParams]);

  // 只对当前列表里看得见的勾选项导出（切换筛选后，被隐藏的勾选不计入）
  const selectedIds = cells.filter((c) => selected.has(c.id)).map((c) => c.id);
  const allChecked = cells.length > 0 && cells.every((c) => selected.has(c.id));
  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function exportExcel() {
    const sp = filterParams();
    if (selectedIds.length) sp.set("ids", selectedIds.join(","));
    try {
      await download(`/api/v1/cells/export?${sp}`, "细胞冻存.xlsx");
    } catch (e) {
      setError(errText(e));
    }
  }

  useEffect(() => {
    api<{ user: { role: string } }>("/api/v1/auth/me").then((d) => setIsAdmin(d.user.role === "admin"), () => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function takeOut(c: Cell) {
    const n = window.prompt(`从「${c.cell_name}」取出几管？（现有 ${c.tube_count ?? "未知"} 管）`, "1");
    if (n === null) return;
    const k = Number(n);
    if (!Number.isInteger(k) || k <= 0) return alert("请输入正整数");
    if (c.tube_count === null) return alert("这条记录的管数未知，请先用「编辑」填写管数");
    if (k > c.tube_count) return alert("取出数量大于现有管数");
    if (k === c.tube_count && !window.confirm(`注意：「${c.cell_name}」${c.tube_count === 1 ? "只剩这最后 1 管" : `只剩 ${c.tube_count} 管，将全部取出`}，取出后库存为 0。确定取出吗？`)) return;
    try {
      await api(`/api/v1/cells/${c.id}`, { method: "PATCH", body: JSON.stringify({ tube_count: c.tube_count - k }) });
      load();
    } catch (e) {
      alert(errText(e));
    }
  }

  return (
    <>
      <h1>细胞冻存</h1>
      <div className="tabs" role="tablist">
        {["", ...[...new Set([...RACKS, ...stats.racks])].sort((a, b) => a - b).map(String)].map((r) => (
          <button key={r} role="tab" aria-selected={filter.rack === r} className={filter.rack === r ? "active" : ""} onClick={() => setFilter({ ...filter, rack: r })}>
            {r ? `${r} 号架` : "全部"}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <label className="field">
          层
          <Combobox
            value={filter.layer}
            allowEmpty
            options={CN.slice(1).map((c, i) => ({ value: String(i + 1), label: `第${c}层` }))}
            onChange={(v) => setFilter({ ...filter, layer: v })}
          />
        </label>
        <label className="field">
          搜索
          <input placeholder="细胞名称 / 来源 / 存放人" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        </label>
        <label className="field">
          来源
          <Combobox value={filter.source} allowEmpty options={options.source} onChange={(v) => setFilter({ ...filter, source: v })} />
        </label>
        <label className="field">
          存放人
          <Combobox value={filter.depositor} allowEmpty options={options.depositor} onChange={(v) => setFilter({ ...filter, depositor: v })} style={{ minWidth: 110 }} />
        </label>
        <label className="field">
          冻存液
          <Combobox value={filter.medium} allowEmpty options={options.freezing_medium} onChange={(v) => setFilter({ ...filter, medium: v })} />
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", minHeight: 32 }}>
          <input type="checkbox" style={{ minHeight: 0 }} checked={filter.review} onChange={(e) => setFilter({ ...filter, review: e.target.checked })} />
          只看待核对（{stats.review}）
        </label>
        <span className="spacer" />
        <button onClick={exportExcel} disabled={!cells.length}>
          {selectedIds.length ? `导出所选（${selectedIds.length} 条）` : `导出当前结果（${cells.length} 条）`}
        </button>
        <button onClick={() => setShowImport(!showImport)}>导入登记表</button>
        <button className="primary" onClick={() => setEditing("new")}>新增记录</button>
      </div>

      {showImport && (
        <ImportBox
          endpoint="/api/v1/cells/import"
          hint="支持原《细胞冻存登记表》.xlsx（每个工作表一个架子，表名如「1号架」），或带「架号」列的 .csv。与系统中完全相同的行会自动跳过。"
          onDone={() => { setShowImport(false); load(); }}
          renderPreview={(d) => (
            <p>
              解析到 {String(d.total)} 条，其中新记录 {String(d.new_rows)} 条，已存在跳过 {String(d.duplicates)} 条，
              需要核对 {String(d.review)} 条。
            </p>
          )}
        />
      )}
      {error && <div className="error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" aria-label="全选" style={{ minHeight: 0 }} checked={allChecked}
                  onChange={() => setSelected(allChecked ? new Set() : new Set(cells.map((c) => c.id)))} />
              </th>
              <th>位置</th><th>细胞名称</th><th>来源</th><th>代次</th><th>密度</th><th>冻存液</th>
              <th>管数</th><th>存放人</th><th>放入时间</th><th></th>
            </tr>
          </thead>
          <tbody>
            {cells.map((c) => (
              <tr key={c.id} className={c.tube_count === 1 ? "low-stock" : ""}>
                <td>
                  <input type="checkbox" aria-label={`选择 ${c.cell_name}`} style={{ minHeight: 0 }} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{c.rack_no} 号架 第{CN[c.layer_no]}层</td>
                <td className="pre">
                  {c.cell_name}
                  {c.needs_review && (
                    <div><span className="flag" title={c.review_reason}>待核对：{c.review_reason}</span></div>
                  )}
                  {c.remarks && <div className="muted">{c.remarks}</div>}
                </td>
                <td>{c.source}</td>
                <td>{c.passage}</td>
                <td>{c.density}</td>
                <td>{c.freezing_medium}</td>
                <td className="num nw">
                  {c.tube_count ?? (c.tube_count_raw ? <span className="muted">{c.tube_count_raw}</span> : "")}
                  {c.tube_count === 1 && <div><span className="flag">仅剩 1 管</span></div>}
                </td>
                <td>{c.depositor}</td>
                <td style={{ whiteSpace: "nowrap" }}>{c.frozen_on ?? (c.frozen_on_raw ? <span className="muted">{c.frozen_on_raw}</span> : "")}</td>
                <td className="actions">
                  <button className="link" onClick={() => takeOut(c)}>取出</button>
                  <button className="link" onClick={() => setEditing(c)}>编辑</button>
                </td>
              </tr>
            ))}
            {!cells.length && (
              <tr><td colSpan={11} className="muted">没有符合条件的记录</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        共 {stats.total} 条，当前显示 {cells.length} 条{selectedIds.length > 0 && <>，已勾选 {selectedIds.length} 条（<button className="link" onClick={() => setSelected(new Set())}>清除</button>）</>}。
        只剩 1 管的记录以黄色标出。不勾选时导出当前筛选结果。
      </p>

      {editing && (
        <CellDialog cell={editing === "new" ? null : editing} isAdmin={isAdmin} options={options} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </>
  );
}

function CellDialog({ cell, isAdmin, options, onClose, onSaved }: { cell: Cell | null; isAdmin: boolean; options: Options; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(() =>
    cell
      ? {
          rack_no: String(cell.rack_no), layer_no: String(cell.layer_no), cell_name: cell.cell_name, source: cell.source,
          passage: cell.passage, density: cell.density, freezing_medium: cell.freezing_medium,
          tube_count: cell.tube_count === null ? "" : String(cell.tube_count), depositor: cell.depositor,
          frozen_on: cell.frozen_on ?? "", remarks: cell.remarks, needs_review: cell.needs_review,
        }
      : { ...EMPTY, frozen_on: new Date().toLocaleDateString("sv-SE") } // 新增时放入时间默认今天
  );
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cell) api<{ history: HistoryItem[] }>(`/api/v1/cells/${cell.id}/history`).then((d) => setHistory(d.history), () => {});
  }, [cell]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (cell) await api(`/api/v1/cells/${cell.id}`, { method: "PATCH", body: JSON.stringify(form) });
      else await api("/api/v1/cells", { method: "POST", body: JSON.stringify(form) });
      onSaved();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!cell || !window.confirm(`确定删除「${cell.cell_name}」这条记录？删除后不可恢复（操作记录中保留快照）。`)) return;
    try {
      await api(`/api/v1/cells/${cell.id}`, { method: "DELETE" });
      onSaved();
    } catch (e) {
      setError(errText(e));
    }
  }

  const text = (k: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">
      {label}
      <input value={String(form[k])} onChange={set(k)} {...props} />
    </label>
  );
  const suggest = (k: keyof Options, label: string, wide = false) => (
    <label className={`field${wide ? " wide" : ""}`}>
      {label}
      <SuggestInput value={form[k]} options={options[k]} onChange={(v) => setForm({ ...form, [k]: v })} />
    </label>
  );

  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <h2 style={{ marginTop: 0 }}>{cell ? "编辑记录" : "新增记录"}</h2>
        {cell?.needs_review && (
          <div className="notice warn">
            待核对：{cell.review_reason}
            {(cell.tube_count_raw || cell.frozen_on_raw) && (
              <div>原表填写：管数「{cell.tube_count_raw}」，放入时间「{cell.frozen_on_raw}」</div>
            )}
          </div>
        )}
        <div className="form-grid">
          {text("rack_no", "架号", { type: "number", min: 1 })}
          <label className="field">
            层
            <Combobox
              value={form.layer_no}
              options={CN.slice(1).map((c, i) => ({ value: String(i + 1), label: `第${c}层` }))}
              onChange={(v) => setForm({ ...form, layer_no: v })}
            />
          </label>
          {text("tube_count", "管数", { type: "number", min: 0 })}
          {text("frozen_on", "放入时间", { type: "date" })}
          {suggest("cell_name", "细胞名称", true)}
          {suggest("source", "来源")}
          {text("passage", "代次")}
          {text("density", "细胞密度")}
          {suggest("freezing_medium", "冻存液")}
          {suggest("depositor", "存放人")}
          <label className="field wide">
            备注
            <input value={form.remarks} onChange={set("remarks")} />
          </label>
          {cell && (
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" style={{ minHeight: 0 }} checked={form.needs_review} onChange={set("needs_review")} />
              待核对（核对完后取消勾选）
            </label>
          )}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="dialog-actions">
          {cell && isAdmin && (
            <button className="danger" onClick={remove} style={{ marginRight: "auto" }}>删除</button>
          )}
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={save} disabled={busy}>保存</button>
        </div>

        {cell && (
          <>
            <h2>修改历史</h2>
            {!history.length && <p className="muted">暂无</p>}
            {history.map((h) => (
              <div key={h.id} style={{ marginBottom: 8 }}>
                <span className="muted">{new Date(h.created_at).toLocaleString("zh-CN")} · {h.actor ?? "系统"}</span>
                <div>
                  {h.action === "cell.update" && h.metadata_json.changes
                    ? Object.entries(h.metadata_json.changes).map(([k, [a, b]]) => (
                        <div key={k}>{LABELS[k] ?? k}：{fmt(a)} → {fmt(b)}</div>
                      ))
                    : h.action === "cell.create" ? "新增" : h.action === "cell.delete" ? "删除" : h.action}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function fmt(v: unknown) {
  if (v === null || v === undefined || v === "") return "（空）";
  if (v === true) return "是";
  if (v === false) return "否";
  return String(v);
}
