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
  note: string;
  last_checked_at: string | null;
  checked_by_name: string | null;
  updated_at: string;
  revision: number;
  status: "out" | "stale" | "ok";
  stale: boolean;
  slot_key: string | null;
  baseline_at: string | null;
  skus: { item_name: string; brand: string; spec_model: string }[];
  monthly_usage: number | null;
  usage_basis: "checks" | "purchases" | null;
  last_purchase: { on: string; quantity: number | null; unit: string } | null;
  pending_inbound: number;
}

interface CategorySummary {
  name: string;
  item_count: number;
  out_count: number;
  stale_count: number;
  last_checked_at: string | null;
}

interface StockResponse {
  groups: CategorySummary[];
  categories: CategorySummary[];
  items: StockItem[];
  summary: { item_count: number; out_count: number; stale_count: number; last_checked_at: string | null };
  stale_days: number;
  review: { pending: number; inbound: number };
}

interface CheckRow {
  id: number;
  before_qty: number;
  after_qty: number;
  note: string;
  checked_at: string;
  checked_by_name: string | null;
  kind: "check" | "inbound";
}

// 一个槽位按整箱/整包计数，数到 0 即需要采购（不管外面有没有已开封的）。
const STATUS_LABEL = { out: "需采购", stale: "需复核", ok: "正常" } as const;
const num = (value: number) => String(Number(value));
const when = (value: string | null) => (value ? new Date(value).toLocaleString("zh-CN") : "尚未核对");
const day = (value: string | null) => (value ? new Date(value).toLocaleDateString("zh-CN") : "");
const skuText = (k: StockItem["skus"][number]) => [k.brand, k.spec_model || k.item_name].filter(Boolean).join(" ");
// 类别存「大类/子类」：标签卡按大类，行内子标签显示子类。
const groupOf = (category: string) => category.split("/")[0];
const subOf = (category: string) => (category.includes("/") ? category.slice(category.indexOf("/") + 1) : "");

const emptyCreate = { category: "", item_name: "", brand: "", spec_model: "", unit: "", quantity: "", note: "" };

function CategoryOptions({ categories }: { categories: CategorySummary[] }) {
  const groups = [...new Set(categories.map((c) => groupOf(c.name)))];
  return groups.map((g) => {
    const own = categories.filter((c) => groupOf(c.name) === g);
    if (own.length === 1 && !subOf(own[0].name)) return <option key={g} value={own[0].name}>{own[0].name}</option>;
    return (
      <optgroup key={g} label={g}>
        {own.map((c) => <option key={c.name} value={c.name}>{subOf(c.name) || c.name}</option>)}
      </optgroup>
    );
  });
}

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
    setCheckForm({ quantity: item.last_checked_at ? num(item.quantity) : "", note: "" });
    setDialogError("");
    setDialog({ kind: "check", item });
  }
  function openEdit(item: StockItem) {
    setEditForm({
      category: item.category, item_name: item.item_name, brand: item.brand, spec_model: item.spec_model,
      unit: item.unit, quantity: "", note: item.note,
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
        spec_model: createForm.spec_model, unit: createForm.unit, note: createForm.note,
      };
      if (createForm.quantity.trim() !== "") body.quantity = createForm.quantity;
      await api("/api/v1/materials/stock", { method: "POST", body: JSON.stringify(body) });
      setDialog(null);
      setNotice("已新增槽位。");
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
          spec_model: editForm.spec_model, unit: editForm.unit, note: editForm.note,
        }),
      });
      setDialog(null);
      setNotice("已保存槽位信息。");
      setRefresh((v) => v + 1);
    } catch (e) {
      setDialogError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: StockItem) {
    if (!window.confirm(`确认删除槽位「${item.item_name}」及其核对历史和已挂货号？此操作不影响采购记录。`)) return;
    setError("");
    try {
      await api(`/api/v1/materials/stock/${item.id}`, { method: "DELETE" });
      setNotice("已删除槽位。");
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(errText(e));
    }
  }

  async function initTemplates() {
    if (!window.confirm("按内置模板建立固定规格槽位（细胞耗材、塑料耗材、通用耗材、培养基、常用试剂）。只补缺失的槽位，不改已有槽位和数量。继续？")) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ templates: number; created: number; skipped: number }>("/api/v1/materials/stock/templates", { method: "POST" });
      setNotice(`模板共 ${result.templates} 个槽位：新建 ${result.created} 个，已存在 ${result.skipped} 个。`);
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function match() {
    if (!window.confirm("扫描展示部门里尚未处理的采购记录：认识的货号直接归到原槽位，其余按规则给出建议槽位，等你在核对工作台确认。不会改动库存数量。继续？")) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ scanned: number; suggested: number; known: number; excluded: number; unmatched: number }>("/api/v1/materials/stock/sync", { method: "POST" });
      setNotice(`扫描 ${result.scanned} 条尚未归入的采购记录：待确认 ${result.suggested} 条，按已知货号归入 ${result.known} 条，按已排除货号排除 ${result.excluded} 条，${result.unmatched} 条不是常用耗材。`);
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const summary = data?.summary;
  const pages = data?.groups ?? [];

  return (
    <>
      <h1>常用耗材库存</h1>
      <p className="muted">
        每行是一个固定规格槽位（如「200µL 滤芯吸头」），品牌货号挂在槽位下，只用来识别采购入库。数量按采购单位整箱/整包计，以人工核对为准：
        第一次核对即为基线，之后由「采购入库确认 + 定期盘点」更新。数量为 0 显示「需采购」，从未核对或超过 {data?.stale_days ?? 30} 天未核对显示「需复核」。
      </p>
      <div className="toolbar">
        <Link href="/materials">← 返回部门物料</Link>
        <span className="spacer" />
        {summary && (
          <span className="muted">
            共 {summary.item_count} 个槽位：需采购 {summary.out_count}、需复核 {summary.stale_count}
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
              {(c.out_count > 0 || c.stale_count > 0) && (
                <span className="stock-alert" title="需采购 + 需复核">⚠{c.out_count + c.stale_count}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="toolbar">
        <label className="field">
          搜索
          <input style={{ width: 220 }} placeholder="槽位名称 / 品牌 / 规格 / 备注" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        </label>
        <label className="field">
          状态
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">全部状态</option>
            <option value="out">需采购</option>
            <option value="stale">需复核</option>
            <option value="ok">正常</option>
          </select>
        </label>
        <span className="spacer" />
        {isAdmin && <button disabled={busy} onClick={initTemplates}>建立槽位模板</button>}
        {isAdmin && <button disabled={busy} onClick={match}>匹配采购记录</button>}
        {isAdmin && data && (
          <Link className="button" href="/materials/stock/review">
            核对工作台
            {data.review.pending + data.review.inbound > 0 && <span className="badge" title="待确认归属 + 待入库">{data.review.pending + data.review.inbound}</span>}
          </Link>
        )}
        {isAdmin && <button className="primary" onClick={openCreate}>新增槽位</button>}
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <p role="status">{notice}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>类别</th><th>槽位</th><th>已挂货号</th><th>单位</th><th>当前库存</th>
              <th>状态</th><th>最近核对</th>
              <th title="有两次以上盘点（相隔 ≥ 28 天）时按盘点差计算；否则按已归入的采购记录估算（标 *）">消耗/月</th>
              <th title="已归入该槽位的最近一笔采购">最近采购</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((item) => (
              <tr key={item.id}>
                <td className="nw">
                  {groupOf(item.category)}
                  {subOf(item.category) && <div><span className="stock-sub">{subOf(item.category)}</span></div>}
                </td>
                <td className="text-col">
                  {item.item_name}
                  {(item.brand || item.spec_model) && <div className="muted">{[item.brand, item.spec_model].filter(Boolean).join(" ")}</div>}
                  {item.note && <div className="muted">{item.note}</div>}
                </td>
                <td className="text-col">
                  {item.skus.length ? (
                    <details>
                      <summary>{item.skus.length} 个</summary>
                      <ul className="stock-skus">{item.skus.map((k, i) => <li key={i} title={k.item_name}>{skuText(k)}</li>)}</ul>
                    </details>
                  ) : <span className="muted">—</span>}
                </td>
                <td className="nw">{item.unit || "—"}</td>
                <td className="num nw">{item.last_checked_at ? num(item.quantity) : "—"}</td>
                <td className="nw">
                  <span className={`stock-status stock-${item.status}`}>{STATUS_LABEL[item.status]}</span>
                  {item.pending_inbound > 0 && (
                    <div>
                      {isAdmin
                        ? <Link href="/materials/stock/review?view=inbound" className="stock-inbound">待入库 {item.pending_inbound}</Link>
                        : <span className="stock-inbound">待入库 {item.pending_inbound}</span>}
                    </div>
                  )}
                </td>
                <td className="nw">
                  {when(item.last_checked_at)}
                  {item.checked_by_name && <div className="muted">{item.checked_by_name}</div>}
                  {item.baseline_at && <div className="muted">基线 {day(item.baseline_at)}</div>}
                </td>
                <td className="num nw">
                  {item.monthly_usage === null ? "" : `${num(item.monthly_usage)} ${item.unit}`}
                  {item.usage_basis === "purchases" && <span className="muted" title="按采购记录估算，盘点满一个月后改为实际消耗">*</span>}
                </td>
                <td className="nw">
                  {item.last_purchase && (
                    <>
                      {item.last_purchase.on}
                      {item.last_purchase.quantity !== null && <div className="muted">{num(item.last_purchase.quantity)} {item.last_purchase.unit}</div>}
                    </>
                  )}
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
                <td colSpan={10} className="muted">
                  {data.summary.item_count ? "没有符合筛选条件的槽位" : "还没有槽位，管理员可点「建立槽位模板」或手动新增。"}
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
              {dialog.kind === "create" ? "新增槽位" : dialog.kind === "check" ? `核对库存：${dialog.item.item_name}` : `编辑槽位：${dialog.item.item_name}`}
            </h2>
            {dialog.kind === "create" && (
              <div className="form-grid">
                <label className="field">
                  类别
                  <select value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}>
                    <CategoryOptions categories={data?.categories ?? []} />
                  </select>
                </label>
                <label className="field">槽位名称<input placeholder="如 48孔板 TC" value={createForm.item_name} onChange={(e) => setCreateForm({ ...createForm, item_name: e.target.value })} /></label>
                <label className="field">品牌（单品试剂才填）<input value={createForm.brand} onChange={(e) => setCreateForm({ ...createForm, brand: e.target.value })} /></label>
                <label className="field">规格型号（单品试剂才填）<input value={createForm.spec_model} onChange={(e) => setCreateForm({ ...createForm, spec_model: e.target.value })} /></label>
                <label className="field">单位（按采购单位，如箱）<input placeholder="箱 / 包 / 瓶" value={createForm.unit} onChange={(e) => setCreateForm({ ...createForm, unit: e.target.value })} /></label>
                <label className="field">
                  初始库存（留空表示待核对）
                  <input type="number" min={0} step="0.01" value={createForm.quantity} onChange={(e) => setCreateForm({ ...createForm, quantity: e.target.value })} />
                </label>
                <label className="field wide">备注<input value={createForm.note} onChange={(e) => setCreateForm({ ...createForm, note: e.target.value })} /></label>
              </div>
            )}
            {dialog.kind === "check" && (
              <>
                <p className="muted">
                  当前库存：{dialog.item.last_checked_at ? `${num(dialog.item.quantity)} ${dialog.item.unit}` : "尚未核对"}；
                  上次核对：{when(dialog.item.last_checked_at)}{dialog.item.checked_by_name ? `（${dialog.item.checked_by_name}）` : ""}。
                  核对会覆盖当前数量并保留历史。{dialog.item.baseline_at ? "" : "这是该槽位第一次核对，将作为基线：基线日及以前的采购视为已数在内，之后的采购在核对工作台确认入库。"}
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
                    <CategoryOptions categories={data?.categories ?? []} />
                  </select>
                </label>
                <label className="field">槽位名称<input value={editForm.item_name} onChange={(e) => setEditForm({ ...editForm, item_name: e.target.value })} /></label>
                <label className="field">品牌<input value={editForm.brand} onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })} /></label>
                <label className="field">规格型号<input value={editForm.spec_model} onChange={(e) => setEditForm({ ...editForm, spec_model: e.target.value })} /></label>
                <label className="field">单位<input value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} /></label>
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
            <p className="muted">最近 20 次盘点与入库。数量变化和备注保留在库存台账中，采购记录不受影响。</p>
            {history.error && <div className="error">{history.error}</div>}
            <div className="table-wrap">
              <table>
                <thead><tr><th>时间</th><th>类型</th><th>操作人</th><th>改前</th><th>改后</th><th>备注</th></tr></thead>
                <tbody>
                  {history.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="nw">{when(row.checked_at)}</td>
                      <td className="nw">{row.kind === "inbound" ? "入库" : "盘点"}</td>
                      <td className="nw">{row.checked_by_name || "账号已删除"}</td>
                      <td className="num">{num(row.before_qty)}</td>
                      <td className="num">{num(row.after_qty)}</td>
                      <td>{row.note || "—"}</td>
                    </tr>
                  ))}
                  {!history.rows.length && !history.error && <tr><td colSpan={6} className="muted">{history.item.last_checked_at ? "没有核对记录。" : "尚未核对过。"}</td></tr>}
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
