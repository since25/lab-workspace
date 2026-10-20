"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, errText } from "@/lib/client";

interface StockItem {
  id: number;
  category: string;
  item_name: string;
  brand: string;
  spec_model: string;
  unit: string;
  quantity: number;
  safety_stock: number;
  note: string;
  last_checked_at: string | null;
  checked_by_name: string | null;
  updated_at: string;
  revision: number;
  status: "unchecked" | "out" | "low" | "ok";
  stale: boolean;
}

interface CategorySummary {
  name: string;
  item_count: number;
  unchecked_count: number;
  out_count: number;
  low_count: number;
  stale_count: number;
  last_checked_at: string | null;
}

interface StockResponse {
  categories: CategorySummary[];
  items: StockItem[];
  summary: { item_count: number; unchecked_count: number; out_count: number; low_count: number; stale_count: number; last_checked_at: string | null };
  stale_days: number;
}

interface CheckRow {
  id: number;
  before_qty: number;
  after_qty: number;
  note: string;
  checked_at: string;
  checked_by_name: string | null;
}

const STATUS_LABEL = { unchecked: "待核对", out: "已用完", low: "偏低", ok: "正常" } as const;
const num = (value: number) => String(Number(value));
const when = (value: string | null) => (value ? new Date(value).toLocaleString("zh-CN") : "尚未核对");

const emptyCreate = { category: "", item_name: "", brand: "", spec_model: "", unit: "", quantity: "", safety_stock: "", note: "" };

type Dialog = { kind: "create" } | { kind: "check"; item: StockItem } | { kind: "edit"; item: StockItem };

export default function ConsumableStockPage() {
  const [data, setData] = useState<StockResponse | null>(null);
  const [f, setF] = useState({ q: "", category: "", status: "" });
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [history, setHistory] = useState<{ item: StockItem; rows: CheckRow[]; error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [checkForm, setCheckForm] = useState({ quantity: "", note: "" });
  const [editForm, setEditForm] = useState(emptyCreate);

  const load = useCallback(async (signal: AbortSignal) => {
    const sp = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== ""));
    try {
      setData(await api<StockResponse>(`/api/v1/materials/stock?${sp}`, { signal }));
      setError("");
    } catch (e) {
      if (!signal.aborted) setError(errText(e));
    }
  }, [f]);

  useEffect(() => {
    api<{ user: { role: string } }>("/api/v1/auth/me").then((d) => setIsAdmin(d.user.role === "admin"), () => {});
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => load(controller.signal), 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load, refresh]);

  function openCreate() {
    setCreateForm({ ...emptyCreate, category: data?.categories[0]?.name ?? "" });
    setDialogError("");
    setDialog({ kind: "create" });
  }
  function openCheck(item: StockItem) {
    setCheckForm({ quantity: item.status === "unchecked" ? "" : num(item.quantity), note: "" });
    setDialogError("");
    setDialog({ kind: "check", item });
  }
  function openEdit(item: StockItem) {
    setEditForm({
      category: item.category, item_name: item.item_name, brand: item.brand, spec_model: item.spec_model,
      unit: item.unit, quantity: "", safety_stock: num(item.safety_stock), note: item.note,
    });
    setDialogError("");
    setDialog({ kind: "edit", item });
  }
  async function openHistory(item: StockItem) {
    setHistory({ item, rows: [], error: "" });
    try {
      const result = await api<{ items: CheckRow[] }>(`/api/v1/materials/stock/${item.id}/checks?limit=20`);
      setHistory({ item, rows: result.items, error: "" });
    } catch (e) {
      setHistory({ item, rows: [], error: errText(e) });
    }
  }

  async function submitCreate() {
    setBusy(true);
    setDialogError("");
    try {
      const body: Record<string, unknown> = {
        category: createForm.category, item_name: createForm.item_name, brand: createForm.brand,
        spec_model: createForm.spec_model, unit: createForm.unit, safety_stock: createForm.safety_stock || 0, note: createForm.note,
      };
      if (createForm.quantity.trim() !== "") body.quantity = createForm.quantity;
      await api("/api/v1/materials/stock", { method: "POST", body: JSON.stringify(body) });
      setDialog(null);
      setNotice("已新增耗材。");
      setRefresh((v) => v + 1);
    } catch (e) {
      setDialogError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitCheck() {
    if (dialog?.kind !== "check") return;
    setBusy(true);
    setDialogError("");
    try {
      await api(`/api/v1/materials/stock/${dialog.item.id}/check`, {
        method: "POST",
        body: JSON.stringify({ quantity: checkForm.quantity, note: checkForm.note, expected_revision: dialog.item.revision }),
      });
      setDialog(null);
      setNotice(`已核对「${dialog.item.item_name}」。`);
      setRefresh((v) => v + 1);
    } catch (e) {
      setDialogError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit() {
    if (dialog?.kind !== "edit") return;
    setBusy(true);
    setDialogError("");
    try {
      await api(`/api/v1/materials/stock/${dialog.item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          category: editForm.category, item_name: editForm.item_name, brand: editForm.brand,
          spec_model: editForm.spec_model, unit: editForm.unit, safety_stock: editForm.safety_stock || 0, note: editForm.note,
        }),
      });
      setDialog(null);
      setNotice("已保存耗材信息。");
      setRefresh((v) => v + 1);
    } catch (e) {
      setDialogError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: StockItem) {
    if (!window.confirm(`确认删除「${item.item_name}」及其核对历史？此操作只删除库存条目，不影响采购记录。`)) return;
    setError("");
    try {
      await api(`/api/v1/materials/stock/${item.id}`, { method: "DELETE" });
      setNotice("已删除耗材条目。");
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(errText(e));
    }
  }

  async function sync() {
    if (!window.confirm("从当前展示部门的采购记录中按类别关键词匹配，只新增缺失的耗材候选，不会修改已有库存。继续？")) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ scanned: number; candidates: number; created: number; skipped: number }>("/api/v1/materials/stock/sync", { method: "POST" });
      setNotice(`扫描 ${result.scanned} 条采购记录，匹配 ${result.candidates} 条，新增 ${result.created} 条，跳过 ${result.skipped} 条已存在条目。`);
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const summary = data?.summary;
  const pages = data?.categories ?? [];

  return (
    <>
      <h1>常用耗材库存</h1>
      <p className="muted">
        按类别汇总细胞房高频耗材，库存数量以最近一次人工核对为准，低于安全库存或超过 {data?.stale_days ?? 30} 天未核对会提示。
        该数量与 OA 采购记录分开保存，采购增量同步不会覆盖核对结果。
      </p>
      <div className="toolbar">
        <Link href="/materials">← 返回部门物料</Link>
        <span className="spacer" />
        {summary && (
          <span className="muted">
            共 {summary.item_count} 种：待核对 {summary.unchecked_count}、已用完 {summary.out_count}、低于安全库存 {summary.low_count}
            {summary.stale_count > 0 && <>、待复核 {summary.stale_count}</>}
          </span>
        )}
      </div>

      {pages.length > 0 && (
        <div className="tabs">
          <button className={f.category === "" ? "active" : ""} onClick={() => setF({ ...f, category: "" })}>
            全部<span className="count">{summary?.item_count ?? 0}</span>
          </button>
          {pages.map((c) => (
            <button key={c.name} className={f.category === c.name ? "active" : ""} onClick={() => setF({ ...f, category: c.name })}>
              {c.name}<span className="count">{c.item_count}</span>
              {(c.unchecked_count > 0 || c.out_count > 0 || c.low_count > 0) && (
                <span className="stock-alert" title="待核对 + 已用完 + 低于安全库存">⚠{c.unchecked_count + c.out_count + c.low_count}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="toolbar">
        <label className="field">
          搜索
          <input style={{ width: 220 }} placeholder="名称 / 品牌 / 规格 / 备注" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        </label>
        <label className="field">
          状态
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">全部状态</option>
            <option value="unchecked">待核对</option>
            <option value="out">已用完</option>
            <option value="low">低于安全库存</option>
            <option value="stale">超过期限未复核</option>
            <option value="ok">正常</option>
          </select>
        </label>
        <span className="spacer" />
        {isAdmin && <button disabled={busy} onClick={sync}>从采购记录生成候选</button>}
        {isAdmin && <button className="primary" onClick={openCreate}>新增耗材</button>}
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <p role="status">{notice}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>类别</th><th>耗材</th><th>品牌 / 规格</th><th>单位</th><th>当前库存</th><th>安全库存</th>
              <th>状态</th><th>最近核对</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((item) => (
              <tr key={item.id}>
                <td className="nw">{item.category}</td>
                <td className="text-col">
                  {item.item_name}
                  {item.note && <div className="muted">{item.note}</div>}
                </td>
                <td>
                  {item.brand || "—"}
                  {item.spec_model && <div className="muted mono">{item.spec_model}</div>}
                </td>
                <td className="nw">{item.unit || "—"}</td>
                <td className="num nw">{item.status === "unchecked" ? "—" : num(item.quantity)}</td>
                <td className="num nw">{item.safety_stock > 0 ? num(item.safety_stock) : "未设"}</td>
                <td className="nw">
                  <span className={`stock-status stock-${item.status}`}>{STATUS_LABEL[item.status]}</span>
                  {item.status !== "unchecked" && item.stale && <div className="stock-stale">超过期限未复核</div>}
                </td>
                <td className="nw">
                  {when(item.last_checked_at)}
                  {item.checked_by_name && <div className="muted">{item.checked_by_name}</div>}
                </td>
                <td className="actions">
                  {isAdmin && <button className="link" disabled={busy} onClick={() => openCheck(item)}>核对</button>}
                  <button className="link" onClick={() => openHistory(item)}>历史</button>
                  {isAdmin && <button className="link" onClick={() => openEdit(item)}>编辑</button>}
                  {isAdmin && <button className="link danger" onClick={() => remove(item)}>删除</button>}
                </td>
              </tr>
            ))}
            {data && !data.items.length && (
              <tr>
                <td colSpan={9} className="muted">
                  {data.summary.item_count ? "没有符合筛选条件的耗材" : "还没有库存条目，管理员可从采购记录生成候选或手动新增。"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {dialog && (
        <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && setDialog(null)}>
          <div className="dialog">
            <h2 style={{ marginTop: 0 }}>
              {dialog.kind === "create" ? "新增耗材" : dialog.kind === "check" ? `核对库存：${dialog.item.item_name}` : `编辑耗材：${dialog.item.item_name}`}
            </h2>
            {dialog.kind === "create" && (
              <div className="form-grid">
                <label className="field">
                  类别
                  <select value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}>
                    {data?.categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </label>
                <label className="field">名称<input value={createForm.item_name} onChange={(e) => setCreateForm({ ...createForm, item_name: e.target.value })} /></label>
                <label className="field">品牌<input value={createForm.brand} onChange={(e) => setCreateForm({ ...createForm, brand: e.target.value })} /></label>
                <label className="field">规格型号<input value={createForm.spec_model} onChange={(e) => setCreateForm({ ...createForm, spec_model: e.target.value })} /></label>
                <label className="field">单位<input placeholder="盒 / 箱 / 瓶" value={createForm.unit} onChange={(e) => setCreateForm({ ...createForm, unit: e.target.value })} /></label>
                <label className="field">
                  初始库存（留空表示待核对）
                  <input type="number" min={0} step="0.01" value={createForm.quantity} onChange={(e) => setCreateForm({ ...createForm, quantity: e.target.value })} />
                </label>
                <label className="field">
                  安全库存
                  <input type="number" min={0} step="0.01" value={createForm.safety_stock} onChange={(e) => setCreateForm({ ...createForm, safety_stock: e.target.value })} />
                </label>
                <label className="field wide">备注<input value={createForm.note} onChange={(e) => setCreateForm({ ...createForm, note: e.target.value })} /></label>
              </div>
            )}
            {dialog.kind === "check" && (
              <>
                <p className="muted">
                  当前库存：{dialog.item.status === "unchecked" ? "尚未核对" : `${num(dialog.item.quantity)} ${dialog.item.unit}`}；
                  上次核对：{when(dialog.item.last_checked_at)}{dialog.item.checked_by_name ? `（${dialog.item.checked_by_name}）` : ""}。
                  核对会覆盖当前数量并保留历史。
                </p>
                <div className="form-grid">
                  <label className="field">
                    实际数量
                    <input type="number" min={0} step="0.01" value={checkForm.quantity} onChange={(e) => setCheckForm({ ...checkForm, quantity: e.target.value })} />
                  </label>
                  <label className="field wide">备注（领用、报损、盘点说明）<input value={checkForm.note} onChange={(e) => setCheckForm({ ...checkForm, note: e.target.value })} /></label>
                </div>
              </>
            )}
            {dialog.kind === "edit" && (
              <div className="form-grid">
                <label className="field">
                  类别
                  <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
                    {data?.categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </label>
                <label className="field">名称<input value={editForm.item_name} onChange={(e) => setEditForm({ ...editForm, item_name: e.target.value })} /></label>
                <label className="field">品牌<input value={editForm.brand} onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })} /></label>
                <label className="field">规格型号<input value={editForm.spec_model} onChange={(e) => setEditForm({ ...editForm, spec_model: e.target.value })} /></label>
                <label className="field">单位<input value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} /></label>
                <label className="field">
                  安全库存
                  <input type="number" min={0} step="0.01" value={editForm.safety_stock} onChange={(e) => setEditForm({ ...editForm, safety_stock: e.target.value })} />
                </label>
                <label className="field wide">备注<input value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} /></label>
                <p className="muted wide">库存数量请用「核对」修改，编辑不会改动当前数量。</p>
              </div>
            )}
            {dialogError && <div className="error">{dialogError}</div>}
            <div className="dialog-actions">
              <button onClick={() => setDialog(null)}>取消</button>
              <button className="primary" disabled={busy} onClick={dialog.kind === "create" ? submitCreate : dialog.kind === "check" ? submitCheck : submitEdit}>
                {dialog.kind === "check" ? "保存核对" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {history && (
        <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && setHistory(null)}>
          <div className="dialog">
            <h2 style={{ marginTop: 0 }}>核对历史：{history.item.item_name}</h2>
            <p className="muted">最近 20 次核对。数量变化和备注保留在库存台账中，采购记录不受影响。</p>
            {history.error && <div className="error">{history.error}</div>}
            <div className="table-wrap">
              <table>
                <thead><tr><th>时间</th><th>操作人</th><th>改前</th><th>改后</th><th>备注</th></tr></thead>
                <tbody>
                  {history.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="nw">{when(row.checked_at)}</td>
                      <td className="nw">{row.checked_by_name || "账号已删除"}</td>
                      <td className="num">{num(row.before_qty)}</td>
                      <td className="num">{num(row.after_qty)}</td>
                      <td>{row.note || "—"}</td>
                    </tr>
                  ))}
                  {!history.rows.length && !history.error && <tr><td colSpan={5} className="muted">{history.item.status === "unchecked" ? "尚未核对过。" : "没有核对记录。"}</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="dialog-actions"><button onClick={() => setHistory(null)}>关闭</button></div>
          </div>
        </div>
      )}
    </>
  );
}
