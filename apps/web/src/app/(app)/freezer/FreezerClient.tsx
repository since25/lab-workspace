"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errText } from "@/lib/client";
import { CONTAINER_WORD, KIND_LABELS, SAMPLE_LABELS, TEMPERATURES, formatLocation, parseSampleLines, rackCellLabel, tempLabel } from "@/lib/freezer";
import Combobox from "../Combobox";
import FreezerMap from "./FreezerMap";
import {
  type Container, type ContainerForm, EMPTY_CONTAINER, type Freezer, type Rack, type Sample,
  containerForm, containerLabel, hasLayout, sampleLocation,
} from "./types";

interface HistoryItem {
  id: number;
  action: string;
  actor: string | null;
  created_at: string;
  metadata_json: { changes?: Record<string, [unknown, unknown]>; from?: string; to?: string; note?: string };
}

const STATUS_OPTIONS = [
  { value: "stored", label: "在库" },
  { value: "removed", label: "已取出" },
  { value: "all", label: "全部状态" },
];

export default function FreezerClient({ userId, isAdmin, canViewAll }: { userId: number; isAdmin: boolean; canViewAll: boolean }) {
  // 选项卡：按冰箱分（"" = 全部）
  const [fid, setFid] = useState("");
  const [view, setView] = useState<"map" | "samples" | "containers">("samples");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [owner, setOwner] = useState("");
  const [filter, setFilter] = useState({ q: "", status: "stored", container: "" });
  const [samples, setSamples] = useState<Sample[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [containers, setContainers] = useState<Container[]>([]);
  const [freezers, setFreezers] = useState<Freezer[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [users, setUsers] = useState<{ id: number; display_name: string }[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<
    | { type: "container"; container: Container | null }
    | { type: "store"; containerId: string; preset?: ContainerForm }
    | { type: "rack"; rack: Rack | { shelf_no: number; position: number } }
    | { type: "batch"; action: "remove" | "move" }
    | { type: "sample"; sample: Sample }
    | { type: "freezers" }
    | null
  >(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const readOnly = scope === "all";
  const current = freezers.find((f) => String(f.id) === fid);
  const showMap = hasLayout(current);
  // 没有布局的冰箱不显示布局图
  const effView = view === "map" && !showMap ? "samples" : view;

  const scopeParams = useCallback(() => {
    const sp = new URLSearchParams();
    if (readOnly) {
      sp.set("scope", "all");
      if (owner) sp.set("owner", owner);
    }
    return sp;
  }, [readOnly, owner]);

  const loadFreezers = useCallback(
    () => api<{ freezers: Freezer[] }>("/api/v1/freezer/freezers").then((d) => setFreezers(d.freezers), (e) => setError(errText(e))),
    []
  );
  const loadContainers = useCallback(
    () =>
      api<{ containers: Container[] }>(`/api/v1/freezer/containers?${scopeParams()}`).then(
        (d) => setContainers(d.containers),
        (e) => setError(errText(e))
      ),
    [scopeParams]
  );
  const loadRacks = useCallback(() => {
    if (!fid) return;
    api<{ racks: Rack[] }>(`/api/v1/freezer/racks?freezer=${fid}`).then((d) => setRacks(d.racks), (e) => setError(errText(e)));
  }, [fid]);
  // 只用当前冰箱的架子（切换冰箱后、新数据回来前不显示上一台的）
  const shownRacks = racks.filter((r) => String(r.freezer_id) === fid);
  const loadSamples = useCallback(async () => {
    const sp = scopeParams();
    if (fid) sp.set("freezer", fid);
    if (filter.q) sp.set("q", filter.q);
    sp.set("status", filter.status);
    if (filter.container) sp.set("container", filter.container);
    try {
      const d = await api<{ samples: Sample[]; counts: Record<string, number> }>(`/api/v1/freezer/samples?${sp}`);
      setSamples(d.samples);
      setCounts(d.counts);
      setError("");
    } catch (e) {
      setError(errText(e));
    }
  }, [scopeParams, fid, filter]);
  const reload = () => {
    loadSamples();
    loadContainers();
    loadRacks();
  };

  useEffect(() => {
    loadFreezers();
  }, [loadFreezers]);
  useEffect(() => {
    if (canViewAll) api<{ owners: { id: number; display_name: string }[] }>("/api/v1/freezer/owners").then((d) => setUsers(d.owners), () => {});
  }, [canViewAll]);
  useEffect(() => {
    loadContainers();
  }, [loadContainers]);
  useEffect(() => {
    loadRacks();
  }, [loadRacks]);
  useEffect(() => {
    const t = setTimeout(loadSamples, 200);
    return () => clearTimeout(t);
  }, [loadSamples]);
  // 只对当前列表里看得见、且是自己的勾选项操作（切换冰箱或筛选后，被隐藏的勾选不计入）
  const mineSamples = readOnly ? [] : samples.filter((s) => s.owner_id === userId);
  const selectedIds = mineSamples.filter((s) => selected.has(s.id)).map((s) => s.id);
  const showOwner = readOnly || samples.some((s) => s.owner_id !== userId);

  const shownContainers = useMemo(() => containers.filter((c) => !fid || String(c.freezer_id) === fid), [containers, fid]);

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }
  const allChecked = mineSamples.length > 0 && mineSamples.every((s) => selected.has(s.id));

  function done(msg = "") {
    setDialog(null);
    setSelected(new Set());
    setMessage(msg);
    reload();
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>冰箱管理</h1>
        <span className="spacer" style={{ flex: 1 }} />
        {canViewAll && (
          <div className="seg">
            <button className={scope === "mine" ? "active" : ""} onClick={() => setScope("mine")}>我的</button>
            <button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>全部人员（只读）</button>
          </div>
        )}
        {isAdmin && <button onClick={() => setDialog({ type: "freezers" })}>管理冰箱</button>}
      </div>

      <div className="tabs" role="tablist">
        {[null, ...freezers].map((f) => {
          const key = f ? String(f.id) : "";
          return (
            <button key={key} role="tab" aria-selected={fid === key} className={fid === key ? "active" : ""}
              onClick={() => {
                setFid(key);
                setFilter({ ...filter, container: "" });
                // 带布局的冰箱默认显示布局图
                if (hasLayout(f ?? undefined)) setView("map");
              }}>
              {f ? <>{f.name}<span className="muted">（{tempLabel(f.temperature)}）</span></> : "全部"}
              <span className="count">{(f ? counts[f.id] : counts.all) ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="toolbar">
        <div className="seg">
          {showMap && <button className={effView === "map" ? "active" : ""} onClick={() => setView("map")}>布局图</button>}
          <button className={effView === "samples" ? "active" : ""} onClick={() => setView("samples")}>样品</button>
          <button className={effView === "containers" ? "active" : ""} onClick={() => setView("containers")}>{CONTAINER_WORD}</button>
        </div>
        {readOnly && (
          <label className="field">
            存放人
            <Combobox value={owner} allowEmpty emptyLabel="全部人员" options={users.map((u) => ({ value: String(u.id), label: u.display_name }))} onChange={setOwner} />
          </label>
        )}
        {effView === "samples" && (
          <>
            <label className="field">
              搜索
              <input
                placeholder="样品 / 项目号 / 类型 / 备注 / 盒子名"
                value={filter.q}
                onChange={(e) => setFilter({ ...filter, q: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && loadSamples()}
              />
            </label>
            <button onClick={loadSamples}>搜索</button>
            <label className="field">
              状态
              <Combobox value={filter.status} options={STATUS_OPTIONS} onChange={(v) => setFilter({ ...filter, status: v })} />
            </label>
            <label className="field">
              {CONTAINER_WORD}
              <Combobox
                value={filter.container}
                allowEmpty
                emptyLabel="全部"
                style={{ minWidth: 220 }}
                options={shownContainers.map((c) => ({ value: String(c.id), label: containerLabel(c) }))}
                onChange={(v) => setFilter({ ...filter, container: v })}
              />
            </label>
          </>
        )}
        <span className="spacer" />
        {!readOnly && (
          <>
            <button onClick={() => setDialog({ type: "container", container: null })}>新建{CONTAINER_WORD}</button>
            <button className="primary" onClick={() => setDialog({ type: "store", containerId: filter.container })}>批量存入</button>
          </>
        )}
      </div>

      {readOnly && <div className="notice">只读视图：可查看所有人存放的样品，不能修改。</div>}
      {!freezers.length && (
        <div className="notice warn">还没有登记冰箱。{isAdmin ? "请先点右上角「管理冰箱」添加。" : "请联系管理员先添加冰箱。"}</div>
      )}
      {message && <div className="notice">{message}</div>}
      {error && <div className="error">{error}</div>}

      {effView === "map" && hasLayout(current) ? (
        <FreezerMap
          freezer={current}
          racks={shownRacks}
          containers={shownContainers}
          userId={userId}
          isAdmin={isAdmin}
          readOnly={readOnly}
          onStore={(t) => setDialog("preset" in t ? { type: "store", containerId: "", preset: t.preset } : { type: "store", containerId: t.containerId })}
          onEditContainer={(c) => setDialog({ type: "container", container: c })}
          onShowSamples={(c) => { setFilter({ q: "", status: "stored", container: String(c.id) }); setView("samples"); }}
          onRack={(rack) => setDialog({ type: "rack", rack })}
          onChanged={(msg) => { setMessage(msg ?? ""); reload(); }}
        />
      ) : effView === "samples" ? (
        <>
          {!readOnly && samples.length > 0 && (
            <div className="selbar">
              <button onClick={() => setSelected(allChecked ? new Set() : new Set(mineSamples.map((s) => s.id)))}>
                {allChecked ? "取消全选" : `全选我的（${mineSamples.length} 管）`}
              </button>
              <span>已选 {selectedIds.length} 管</span>
              <button disabled={!selectedIds.length} onClick={() => setDialog({ type: "batch", action: "remove" })}>取出</button>
              <button disabled={!selectedIds.length} onClick={() => setDialog({ type: "batch", action: "move" })}>转移到{CONTAINER_WORD}…</button>
              {selectedIds.length > 0 && <button className="link" onClick={() => setSelected(new Set())}>清除选择</button>}
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {!readOnly && (
                    <th style={{ width: 28 }}>
                      <input type="checkbox" aria-label="全选" style={{ minHeight: 0 }} checked={allChecked}
                        onChange={() => setSelected(allChecked ? new Set() : new Set(mineSamples.map((s) => s.id)))} />
                    </th>
                  )}
                  <th>样品信息</th><th>位置</th><th>项目号</th><th>样品类型</th><th>备注</th><th>存入日期</th>
                  {showOwner && <th>存放人</th>}
                  {filter.status !== "stored" && <th>状态</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {samples.map((s) => (
                  <tr key={s.id}>
                    {!readOnly && (
                      <td>
                        {s.owner_id === userId && (
                          <input type="checkbox" aria-label={`选择 ${s.name}`} style={{ minHeight: 0 }} checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                        )}
                      </td>
                    )}
                    <td className="text-col">{s.name}</td>
                    <td className="text-col">
                      {s.is_shared && <span className="tag">公共</span>}
                      {sampleLocation(s) || <span className="muted">（盒子/框已删除）</span>}
                    </td>
                    <td>{s.project_no}</td>
                    <td>{s.sample_type}</td>
                    <td className="text-col">{s.remarks}</td>
                    <td className="nw">{s.stored_on}</td>
                    {showOwner && <td className="nw">{s.owner_name}</td>}
                    {filter.status !== "stored" && (
                      <td className="nw">{s.status === "stored" ? "在库" : <span className="flag">已取出</span>}</td>
                    )}
                    <td className="actions">
                      <button className="link" onClick={() => setDialog({ type: "sample", sample: s })}>{readOnly || s.owner_id !== userId ? "详情" : "编辑"}</button>
                    </td>
                  </tr>
                ))}
                {!samples.length && (
                  <tr><td colSpan={10} className="muted">没有符合条件的样品</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            当前显示 {samples.length} 管。
            {readOnly ? "每管的流转记录在「详情」里查看。" : "勾选样品后可批量取出或转移到其他盒子/框（可当场新建），每管的流转记录在「编辑」里查看。公共框里别人存的样品只能查看。"}
          </p>
        </>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{CONTAINER_WORD}</th><th>位置</th><th>在库样品</th><th>备注</th>
                {readOnly && <th>存放人</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shownContainers.map((c) => (
                <tr key={c.id}>
                  <td className="text-col">{c.is_shared && <span className="tag">公共</span>}{KIND_LABELS[c.kind]}「{c.name}」</td>
                  <td className="text-col">{formatLocation(c)}</td>
                  <td className="num">{c.sample_count}</td>
                  <td className="text-col">{c.remarks}</td>
                  {readOnly && <td className="nw">{c.owner_name}</td>}
                  <td className="actions">
                    <button className="link" onClick={() => { setFilter({ q: "", status: "stored", container: String(c.id) }); setView("samples"); }}>查看样品</button>
                    {!readOnly && (
                      <>
                        <button className="link" onClick={() => setDialog({ type: "store", containerId: String(c.id) })}>存入</button>
                        {(c.owner_id === userId || (c.is_shared && isAdmin)) && (
                          <button className="link" onClick={() => setDialog({ type: "container", container: c })}>编辑</button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!shownContainers.length && (
                <tr><td colSpan={6} className="muted">没有盒子/框</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.type === "container" && (
        <ContainerDialog container={dialog.container} freezers={freezers} isAdmin={isAdmin} defaultFreezer={fid} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.type === "store" && (
        <StoreDialog initialContainer={dialog.containerId} preset={dialog.preset} containers={containers} freezers={freezers} isAdmin={isAdmin} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.type === "batch" && (
        <BatchDialog action={dialog.action} ids={selectedIds} containers={containers} freezers={freezers} isAdmin={isAdmin} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.type === "sample" && (
        <SampleDialog sample={dialog.sample} readOnly={readOnly || dialog.sample.owner_id !== userId} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.type === "freezers" && (
        <FreezersDialog freezers={freezers} onClose={() => setDialog(null)} onChanged={() => { loadFreezers(); loadContainers(); }} />
      )}
      {dialog?.type === "rack" && current && (
        <RackDialog freezerId={current.id} rack={dialog.rack} onClose={() => setDialog(null)} onSaved={done} />
      )}
    </>
  );
}

// ---------- 盒子/框表单 ----------

function ContainerFields({ form, setForm, freezers, isAdmin, fixedPlace }: {
  form: ContainerForm; setForm: (f: ContainerForm) => void; freezers: Freezer[]; isAdmin: boolean;
  // 从布局图点空格新建时，位置已定，只填名称和备注
  fixedPlace?: string;
}) {
  const set = (k: keyof ContainerForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const layout = hasLayout(freezers.find((f) => String(f.id) === form.freezer_id));
  return (
    <div className="form-grid">
      {fixedPlace ? (
        <div className="field wide">位置：{fixedPlace}</div>
      ) : (
        <>
          <label className="field">
            冰箱
            <Combobox
              value={form.freezer_id}
              options={freezers.filter((f) => f.is_active).map((f) => ({ value: String(f.id), label: `${f.name}（${tempLabel(f.temperature)}）` }))}
              onChange={(v) => setForm({ ...form, freezer_id: v })}
            />
          </label>
          <label className="field">
            类型
            <div className="seg">
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <button key={k} type="button" className={form.kind === k ? "active" : ""} onClick={() => setForm({ ...form, kind: k })}>{label}</button>
              ))}
            </div>
          </label>
        </>
      )}
      <label className="field wide">
        {form.kind === "basket" ? "框" : "盒子"}名称
        <input value={form.name} placeholder="如：张三 质粒盒 1、XX 部门交付试剂 2026-10" onChange={set("name")} />
      </label>
      {!fixedPlace && (
        <>
          <label className="field">
            冰箱第几层
            <input type="number" min={1} value={form.shelf_no} onChange={set("shelf_no")} />
          </label>
          <label className="field">
            第几个架子（选填）
            <input type="number" min={1} value={form.rack_no} onChange={set("rack_no")} />
          </label>
          {layout ? (
            <>
              <label className="field">
                架内第几层（选填）
                <input type="number" min={1} value={form.tier_no} onChange={set("tier_no")} />
              </label>
              <label className="field">
                该层第几盒（选填）
                <input type="number" min={1} value={form.depth_no} onChange={set("depth_no")} />
              </label>
            </>
          ) : (
            <label className="field">
              架内第几格（选填）
              <input type="number" min={1} value={form.slot_no} onChange={set("slot_no")} />
            </label>
          )}
        </>
      )}
      <label className="field wide">
        备注
        <input value={form.remarks} onChange={set("remarks")} />
      </label>
      {isAdmin && !fixedPlace && (
        <label className="wide" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" style={{ minHeight: 0 }} checked={form.is_shared} onChange={(e) => setForm({ ...form, is_shared: e.target.checked })} />
          公共（所有人都能看到并往里存入，每管样品只有存放人能取出和修改）
        </label>
      )}
    </div>
  );
}

const CONTAINER_HINT = "盒子/框 = 冰箱里的一个冻存盒或一个框。试剂/样品的名称不在这里填，建好后点「存入」逐管填写；一个框里有几种试剂就填几行。";

function ContainerDialog({ container, freezers, isAdmin, defaultFreezer, onClose, onSaved }: {
  container: Container | null; freezers: Freezer[]; isAdmin: boolean; defaultFreezer: string; onClose: () => void; onSaved: (msg?: string) => void;
}) {
  const [form, setForm] = useState(() => (container ? containerForm(container) : { ...EMPTY_CONTAINER, freezer_id: defaultFreezer }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const d = container
        ? await api<{ warning: string }>(`/api/v1/freezer/containers/${container.id}`, { method: "PATCH", body: JSON.stringify(form) })
        : await api<{ warning: string }>("/api/v1/freezer/containers", { method: "POST", body: JSON.stringify(form) });
      onSaved(d.warning || (container ? "已保存。" : "已新建，可以点「存入」放样品。"));
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!container || !window.confirm(`删除「${container.name}」？只能删除里面没有在库样品的盒子/框。`)) return;
    try {
      await api(`/api/v1/freezer/containers/${container.id}`, { method: "DELETE" });
      onSaved("已删除。");
    } catch (e) {
      setError(errText(e));
    }
  }

  return (
    <Dialog title={container ? `编辑${CONTAINER_WORD}` : `新建${CONTAINER_WORD}`} onClose={onClose}>
      <p className="muted">{container ? "修改位置后，里面的样品随之一起移动。" : CONTAINER_HINT}</p>
      <ContainerFields form={form} setForm={setForm} freezers={freezers} isAdmin={isAdmin} />
      {error && <div className="error">{error}</div>}
      <div className="dialog-actions">
        {container && <button className="danger" style={{ marginRight: "auto" }} onClick={remove}>删除</button>}
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={save} disabled={busy}>保存</button>
      </div>
    </Dialog>
  );
}

// 选择已有容器或当场新建（批量存入、批量转移共用）
function TargetPicker({
  mode, setMode, containerId, setContainerId, form, setForm, containers, freezers, isAdmin,
}: {
  mode: "existing" | "new"; setMode: (m: "existing" | "new") => void;
  containerId: string; setContainerId: (v: string) => void;
  form: ContainerForm; setForm: (f: ContainerForm) => void;
  containers: Container[]; freezers: Freezer[]; isAdmin: boolean;
}) {
  return (
    <>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button type="button" className={mode === "existing" ? "active" : ""} onClick={() => setMode("existing")}>已有{CONTAINER_WORD}</button>
        <button type="button" className={mode === "new" ? "active" : ""} onClick={() => setMode("new")}>新建{CONTAINER_WORD}</button>
      </div>
      {mode === "existing" ? (
        <label className="field" style={{ marginBottom: 12 }}>
          放到哪个{CONTAINER_WORD}
          <Combobox value={containerId} placeholder="选择" options={containers.map((c) => ({ value: String(c.id), label: containerLabel(c) }))} onChange={setContainerId} />
        </label>
      ) : (
        <>
          <p className="muted">{CONTAINER_HINT}</p>
          <ContainerFields form={form} setForm={setForm} freezers={freezers} isAdmin={isAdmin} />
        </>
      )}
    </>
  );
}

function targetBody(mode: "existing" | "new", containerId: string, form: ContainerForm) {
  return mode === "new" ? { new_container: form } : { container_id: containerId };
}

// ---------- 批量存入 ----------

function StoreDialog({ initialContainer, preset, containers, freezers, isAdmin, onClose, onSaved }: {
  initialContainer: string; preset?: ContainerForm; containers: Container[]; freezers: Freezer[]; isAdmin: boolean;
  onClose: () => void; onSaved: (msg?: string) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(preset || !containers.length ? "new" : "existing");
  const [containerId, setContainerId] = useState(initialContainer);
  const [form, setForm] = useState(preset ?? EMPTY_CONTAINER);
  const presetPlace = useMemo(() => {
    if (!preset) return "";
    const f = freezers.find((x) => String(x.id) === preset.freezer_id);
    return `${f?.name ?? ""} · 第${preset.shelf_no}层 · ${preset.rack_no}号架 · ${rackCellLabel(Number(preset.tier_no), Number(preset.depth_no))}`;
  }, [preset, freezers]);
  const [defaults, setDefaults] = useState({ project_no: "", sample_type: "", remarks: "" });
  const [storedOn, setStoredOn] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => parseSampleLines(text, defaults), [text, defaults]);

  async function save() {
    if (!rows.length) return setError("请至少填写一管样品");
    setBusy(true);
    setError("");
    try {
      const d = await api<{ ids: number[]; warning: string }>("/api/v1/freezer/samples", {
        method: "POST",
        body: JSON.stringify({ ...targetBody(mode, containerId, form), stored_on: storedOn, samples: rows }),
      });
      onSaved(`已存入 ${d.ids.length} 管。${d.warning}`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Dialog title={preset ? "放新盒子并存入样品" : "批量存入"} onClose={onClose} wide>
      <h2 style={{ marginTop: 0 }}>1. {preset ? "给这个盒子起个名字" : `存到哪个${CONTAINER_WORD}`}</h2>
      {preset ? (
        <ContainerFields form={form} setForm={setForm} freezers={freezers} isAdmin={isAdmin} fixedPlace={presetPlace} />
      ) : (
        <TargetPicker mode={mode} setMode={setMode} containerId={containerId} setContainerId={setContainerId} form={form} setForm={setForm} containers={containers} freezers={freezers} isAdmin={isAdmin} />
      )}
      <h2>2. 样品清单（一行一管）</h2>
      <p className="muted">
        每行依次为：样品信息、项目号、样品类型、备注，可直接从 Excel 复制这几列粘贴；只写样品信息也可以，其余列留空时使用下面的统一填写。
      </p>
      <div className="form-grid">
        <label className="field">统一项目号<input value={defaults.project_no} onChange={(e) => setDefaults({ ...defaults, project_no: e.target.value })} /></label>
        <label className="field">统一样品类型<input value={defaults.sample_type} onChange={(e) => setDefaults({ ...defaults, sample_type: e.target.value })} /></label>
        <label className="field">统一备注<input value={defaults.remarks} onChange={(e) => setDefaults({ ...defaults, remarks: e.target.value })} /></label>
        <label className="field">存入日期<input type="date" value={storedOn} onChange={(e) => setStoredOn(e.target.value)} /></label>
      </div>
      <textarea style={{ width: "100%", minHeight: 140 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={"试剂 A\n试剂 B\n……"} />
      {rows.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 240, overflowY: "auto", marginTop: 8 }}>
          <table>
            <thead>
              <tr><th>#</th>{(["name", "project_no", "sample_type", "remarks"] as const).map((k) => <th key={k}>{SAMPLE_LABELS[k]}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}><td className="num">{i + 1}</td><td>{r.name}</td><td>{r.project_no}</td><td>{r.sample_type}</td><td>{r.remarks}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="dialog-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={save} disabled={busy || !rows.length || (!!preset && !form.name.trim())}>存入 {rows.length} 管</button>
      </div>
    </Dialog>
  );
}

// ---------- 批量取出 / 转移 ----------

function BatchDialog({ action, ids, containers, freezers, isAdmin, onClose, onSaved }: {
  action: "remove" | "move"; ids: number[]; containers: Container[]; freezers: Freezer[]; isAdmin: boolean; onClose: () => void; onSaved: (msg?: string) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [containerId, setContainerId] = useState("");
  const [form, setForm] = useState(EMPTY_CONTAINER);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const d = await api<{ done: number; skipped: number; warning: string }>("/api/v1/freezer/samples/batch", {
        method: "POST",
        body: JSON.stringify({ ids, action, note, ...(action === "move" ? targetBody(mode, containerId, form) : {}) }),
      });
      const verb = action === "remove" ? "取出" : "转移";
      onSaved(`已${verb} ${d.done} 管${d.skipped ? `，${d.skipped} 管无需处理（已取出或已在目标位置）` : ""}。${d.warning}`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Dialog title={action === "remove" ? `取出 ${ids.length} 管` : `转移 ${ids.length} 管`} onClose={onClose}>
      {action === "remove" ? (
        <p className="muted">取出后样品默认不再显示在库存中，记录保留，可在状态「已取出」里查到，也可再转移回盒子/框。</p>
      ) : (
        <TargetPicker mode={mode} setMode={setMode} containerId={containerId} setContainerId={setContainerId} form={form} setForm={setForm} containers={containers} freezers={freezers} isAdmin={isAdmin} />
      )}
      <label className="field">
        用途 / 说明（选填）
        <input value={note} placeholder="如：第三轮实验" onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <div className="error">{error}</div>}
      <div className="dialog-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={save} disabled={busy}>确定</button>
      </div>
    </Dialog>
  );
}

// ---------- 样品详情 / 编辑 ----------

const ACTION_TEXT: Record<string, string> = {
  "freezer_sample.create": "存入",
  "freezer_sample.update": "修改",
  "freezer_sample.move": "转移",
  "freezer_sample.remove": "取出",
};

function SampleDialog({ sample, readOnly, onClose, onSaved }: { sample: Sample; readOnly: boolean; onClose: () => void; onSaved: (msg?: string) => void }) {
  const [form, setForm] = useState({ name: sample.name, project_no: sample.project_no, sample_type: sample.sample_type, remarks: sample.remarks });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ history: HistoryItem[] }>(`/api/v1/freezer/samples/${sample.id}/history`).then((d) => setHistory(d.history), () => {});
  }, [sample.id]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/freezer/samples/${sample.id}`, { method: "PATCH", body: JSON.stringify(form) });
      onSaved("样品已保存。");
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`删除「${sample.name}」？只用于删除录错的记录；正常用完请用「取出」，保留记录。`)) return;
    try {
      await api(`/api/v1/freezer/samples/${sample.id}`, { method: "DELETE" });
      onSaved("样品记录已删除。");
    } catch (e) {
      setError(errText(e));
    }
  }

  return (
    <Dialog title={readOnly ? "样品详情" : "编辑样品"} onClose={onClose}>
      <p className="muted">
        位置：{sampleLocation(sample) || "（盒子/框已删除）"}
        {sample.status === "removed" && <> · <span className="flag">已取出</span></>}
        {readOnly && <> · 存放人：{sample.owner_name}</>}
      </p>
      <div className="form-grid">
        {(["name", "project_no", "sample_type", "remarks"] as const).map((k) => (
          <label key={k} className={`field${k === "name" || k === "remarks" ? " wide" : ""}`}>
            {SAMPLE_LABELS[k]}
            <input value={form[k]} readOnly={readOnly} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      <div className="dialog-actions">
        {!readOnly && <button className="danger" style={{ marginRight: "auto" }} onClick={remove}>删除记录</button>}
        <button onClick={onClose}>{readOnly ? "关闭" : "取消"}</button>
        {!readOnly && <button className="primary" onClick={save} disabled={busy}>保存</button>}
      </div>

      <h2>流转记录</h2>
      {!history.length && <p className="muted">暂无</p>}
      {history.map((h) => {
        const m = h.metadata_json;
        return (
          <div key={h.id} style={{ marginBottom: 8 }}>
            <span className="muted">{new Date(h.created_at).toLocaleString("zh-CN")} · {h.actor ?? "系统"} · {ACTION_TEXT[h.action] ?? h.action}</span>
            {m.changes && Object.entries(m.changes).map(([k, [a, b]]) => (
              <div key={k}>{SAMPLE_LABELS[k] ?? k}：{String(a || "（空）")} → {String(b || "（空）")}</div>
            ))}
            {m.from && <div>从：{m.from}</div>}
            {m.to && <div>到：{m.to}</div>}
            {m.note && <div>说明：{m.note}</div>}
          </div>
        );
      })}
    </Dialog>
  );
}

// ---------- 冰箱清单（管理员） ----------

const EMPTY_FREEZER = { name: "", temperature: "-80", location: "", remarks: "", is_active: true, shelf_count: "", racks_per_shelf: "" };

function FreezersDialog({ freezers, onClose, onChanged }: { freezers: Freezer[]; onClose: () => void; onChanged: () => void }) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState(EMPTY_FREEZER);
  const [error, setError] = useState("");

  function edit(f: Freezer | null) {
    setError("");
    setEditing(f ? f.id : "new");
    setForm(
      f
        ? {
            name: f.name, temperature: f.temperature, location: f.location, remarks: f.remarks, is_active: f.is_active,
            shelf_count: f.shelf_count === null ? "" : String(f.shelf_count), racks_per_shelf: f.racks_per_shelf === null ? "" : String(f.racks_per_shelf),
          }
        : EMPTY_FREEZER
    );
  }

  async function save() {
    setError("");
    try {
      if (editing === "new") await api("/api/v1/freezer/freezers", { method: "POST", body: JSON.stringify(form) });
      else await api(`/api/v1/freezer/freezers/${editing}`, { method: "PATCH", body: JSON.stringify(form) });
      setEditing(null);
      onChanged();
    } catch (e) {
      setError(errText(e));
    }
  }

  async function remove(f: Freezer) {
    if (!window.confirm(`删除冰箱「${f.name}」？只能删除没有登记盒子/框和架子的冰箱。`)) return;
    setError("");
    try {
      await api(`/api/v1/freezer/freezers/${f.id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      setError(errText(e));
    }
  }

  return (
    <Dialog title="管理冰箱" onClose={onClose}>
      <p className="muted">
        冰箱由管理员统一维护，其他人新建盒子/框时只能从这里选择。停用后不能再往里新建，已有记录不受影响。
        带架子的冰箱（如 -80℃）填写「布局」后会显示布局图，可在图上放架子并分配给个人；只有隔板的冰箱不用填。
      </p>
      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table>
          <thead><tr><th>名称</th><th>温度</th><th>布局</th><th>存放地点</th><th>备注</th><th>状态</th><th></th></tr></thead>
          <tbody>
            {freezers.map((f) => (
              <tr key={f.id}>
                <td>{f.name}</td><td className="nw">{tempLabel(f.temperature)}</td>
                <td className="nw">{hasLayout(f) ? `${f.shelf_count} 层 × 每层 ${f.racks_per_shelf} 架` : <span className="muted">—</span>}</td>
                <td>{f.location}</td><td>{f.remarks}</td>
                <td className="nw">{f.is_active ? "启用" : <span className="muted">停用</span>}</td>
                <td className="actions">
                  <button className="link" onClick={() => edit(f)}>编辑</button>
                  <button className="link" onClick={() => remove(f)}>删除</button>
                </td>
              </tr>
            ))}
            {!freezers.length && <tr><td colSpan={7} className="muted">还没有冰箱</td></tr>}
          </tbody>
        </table>
      </div>
      {editing === null ? (
        <button onClick={() => edit(null)}>添加冰箱</button>
      ) : (
        <div className="panel">
          <div className="form-grid">
            <label className="field">名称<input value={form.name} placeholder="如：-80 1号" onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field">
              温度
              <Combobox value={form.temperature} options={TEMPERATURES.map((t) => ({ value: t, label: tempLabel(t) }))} onChange={(v) => setForm({ ...form, temperature: v })} />
            </label>
            <label className="field">存放地点<input value={form.location} placeholder="如：203 室" onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
            <label className="field">备注<input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></label>
            <label className="field">
              布局：总层数（带架子的才填）
              <input type="number" min={1} max={20} value={form.shelf_count} placeholder="如 4" onChange={(e) => setForm({ ...form, shelf_count: e.target.value })} />
            </label>
            <label className="field">
              布局：每层几个架位
              <input type="number" min={1} max={20} value={form.racks_per_shelf} placeholder="如 4" onChange={(e) => setForm({ ...form, racks_per_shelf: e.target.value })} />
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" style={{ minHeight: 0 }} checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              启用
            </label>
          </div>
          <div className="dialog-actions" style={{ marginTop: 0 }}>
            <button onClick={() => setEditing(null)}>取消</button>
            <button className="primary" onClick={save}>保存</button>
          </div>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="dialog-actions">
        <button onClick={onClose}>关闭</button>
      </div>
    </Dialog>
  );
}

// ---------- 架子（管理员）：放置、分配、规格、移除 ----------

function RackDialog({ freezerId, rack, onClose, onSaved }: {
  freezerId: number; rack: Rack | { shelf_no: number; position: number }; onClose: () => void; onSaved: (msg?: string) => void;
}) {
  const existing = "id" in rack ? rack : null;
  const [form, setForm] = useState({
    owner_id: existing?.owner_id ? String(existing.owner_id) : "",
    tiers: String(existing?.tiers ?? 5),
    depth: String(existing?.depth ?? 4),
    remarks: existing?.remarks ?? "",
  });
  const [users, setUsers] = useState<{ id: number; display_name: string; username: string; is_active: boolean }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ users: typeof users }>("/api/v1/admin/users").then((d) => setUsers(d.users.filter((u) => u.is_active)), (e) => setError(errText(e)));
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (existing) await api(`/api/v1/freezer/racks/${existing.id}`, { method: "PATCH", body: JSON.stringify(form) });
      else await api("/api/v1/freezer/racks", { method: "POST", body: JSON.stringify({ ...form, freezer_id: freezerId, shelf_no: rack.shelf_no, position: rack.position }) });
      onSaved(existing ? "架子已保存。" : "架子已放好。");
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing || !window.confirm(`移除第 ${rack.shelf_no} 层 ${rack.position}号架？架子上不能还有盒子。`)) return;
    try {
      await api(`/api/v1/freezer/racks/${existing.id}`, { method: "DELETE" });
      onSaved("架子已移除。");
    } catch (e) {
      setError(errText(e));
    }
  }

  return (
    <Dialog title={`第 ${rack.shelf_no} 层 · ${rack.position}号架${existing ? "" : "（放置新架子）"}`} onClose={onClose}>
      <p className="muted">只有被分配的人能往这个架子里放盒子；改分配不会移动已有盒子。不确定每层放几盒时，可先按实际数一下再改。</p>
      <div className="form-grid">
        <label className="field">
          分配给
          <Combobox
            value={form.owner_id}
            allowEmpty
            emptyLabel="暂不分配"
            options={users.map((u) => ({ value: String(u.id), label: `${u.display_name}（${u.username}）` }))}
            onChange={(v) => setForm({ ...form, owner_id: v })}
          />
        </label>
        <label className="field">架内层数<input type="number" min={1} max={20} value={form.tiers} onChange={(e) => setForm({ ...form, tiers: e.target.value })} /></label>
        <label className="field">每层盒位数<input type="number" min={1} max={20} value={form.depth} onChange={(e) => setForm({ ...form, depth: e.target.value })} /></label>
        <label className="field wide">备注<input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></label>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="dialog-actions">
        {existing && <button className="danger" style={{ marginRight: "auto" }} onClick={remove}>移除架子</button>}
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={save} disabled={busy}>保存</button>
      </div>
    </Dialog>
  );
}

function Dialog({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={wide ? { maxWidth: 900 } : undefined}>
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
