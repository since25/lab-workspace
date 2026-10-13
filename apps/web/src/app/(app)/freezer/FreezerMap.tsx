"use client";

import { useEffect, useMemo, useState } from "react";
import { api, errText } from "@/lib/client";
import { KIND_LABELS, rackCellLabel } from "@/lib/freezer";
import { type Container, type ContainerForm, EMPTY_CONTAINER, type Freezer, type Rack, type Sample } from "./types";

type LayoutFreezer = Freezer & { shelf_count: number; racks_per_shelf: number };

// 带架子的冰箱（-80℃）布局图：
// 冰箱各层 → 每层的架子（显示分配给谁、用了几个盒位）→ 点开自己的架子看「架内层 × 盒位」格子，
// 点空格直接放新盒子并存入样品，点盒子查看里面的样品；没有架子的层（如最下层公共框）列出该层的盒子/框。
export default function FreezerMap({
  freezer, racks, containers, userId, isAdmin, readOnly,
  onStore, onEditContainer, onShowSamples, onRack, onChanged,
}: {
  freezer: LayoutFreezer;
  racks: Rack[];
  containers: Container[];
  userId: number;
  isAdmin: boolean;
  readOnly: boolean;
  onStore: (t: { containerId: string } | { preset: ContainerForm }) => void;
  onEditContainer: (c: Container) => void;
  onShowSamples: (c: Container) => void;
  onRack: (r: Rack | { shelf_no: number; position: number }) => void;
  onChanged: (msg?: string) => void;
}) {
  const [rackId, setRackId] = useState<number | null>(null);
  const [containerId, setContainerId] = useState<number | null>(null);
  // 正在给某个盒子挑新格位（待归位或移动）
  const [moving, setMoving] = useState<Container | null>(null);
  const [error, setError] = useState("");

  const rack = racks.find((r) => r.id === rackId) ?? null;
  const selected = containers.find((c) => c.id === containerId) ?? null;
  const rackAt = (shelf: number, pos: number) => racks.find((r) => r.shelf_no === shelf && r.position === pos);
  const inRack = (c: Container, r: Rack) => c.shelf_no === r.shelf_no && c.rack_no === r.position;
  // 不在任何架子上的盒子/框（按层列出）
  const loose = useMemo(
    () => containers.filter((c) => c.rack_no === null || !racks.some((r) => inRack(c, r))),
    [containers, racks]
  );
  const canUse = (r: Rack) => !readOnly && r.owner_id === userId;
  const canSee = (r: Rack) => readOnly || r.owner_id === userId;

  function pickRack(r: Rack) {
    setRackId(r.id === rackId ? null : r.id);
    setContainerId(null);
    setMoving(null);
    setError("");
  }

  async function moveTo(r: Rack, tier: number, depth: number) {
    if (!moving) return;
    setError("");
    try {
      await api(`/api/v1/freezer/containers/${moving.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          freezer_id: freezer.id, kind: moving.kind, name: moving.name, shelf_no: r.shelf_no, rack_no: r.position,
          tier_no: tier, depth_no: depth, slot_no: "", remarks: moving.remarks, is_shared: moving.is_shared,
        }),
      });
      setMoving(null);
      setContainerId(moving.id);
      onChanged(`已把「${moving.name}」放到 ${r.position}号架 ${rackCellLabel(tier, depth)}。`);
    } catch (e) {
      setError(errText(e));
    }
  }

  function clickEmpty(r: Rack, tier: number, depth: number) {
    if (!canUse(r)) return;
    if (moving) return void moveTo(r, tier, depth);
    onStore({
      preset: {
        ...EMPTY_CONTAINER, freezer_id: String(freezer.id), kind: "box", shelf_no: String(r.shelf_no),
        rack_no: String(r.position), tier_no: String(tier), depth_no: String(depth),
      },
    });
  }

  const shelves = Array.from({ length: freezer.shelf_count }, (_, i) => i + 1);
  const positions = Array.from({ length: freezer.racks_per_shelf }, (_, i) => i + 1);

  return (
    <div className="fmap">
      <p className="muted">
        点自己的架子展开格子，点空格即可放盒子并存入样品。架子由管理员分配，别人的架子只显示占用情况。
        {isAdmin && " 管理员：点空架位可放架子，点架子上的「分配」可改分配人和规格。"}
      </p>
      {shelves.map((shelf) => {
        const shelfRacks = racks.filter((r) => r.shelf_no === shelf);
        const shelfLoose = loose.filter((c) => c.shelf_no === shelf);
        const showSlots = shelfRacks.length > 0 || isAdmin;
        return (
          <div key={shelf} className="fshelf">
            <div className="fshelf-label">第 {shelf} 层</div>
            <div>
              {showSlots && (
                <div className="fshelf-racks" style={{ gridTemplateColumns: `repeat(${freezer.racks_per_shelf}, minmax(132px, 1fr))` }}>
                  {positions.map((pos) => {
                    const r = rackAt(shelf, pos);
                    if (!r) {
                      return isAdmin && !readOnly ? (
                        <button key={pos} className="rack-card empty" onClick={() => onRack({ shelf_no: shelf, position: pos })}>
                          {pos}号架位 · 空<br /><span className="muted">＋ 放架子</span>
                        </button>
                      ) : (
                        <div key={pos} className="rack-card empty">{pos}号架位 · 空</div>
                      );
                    }
                    const cap = r.tiers * r.depth;
                    const mine = r.owner_id === userId;
                    return (
                      <div
                        key={pos}
                        role="button"
                        tabIndex={0}
                        className={`rack-card${mine ? " mine" : ""}${r.id === rackId ? " selected" : ""}`}
                        onClick={() => pickRack(r)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pickRack(r))}
                      >
                        <div className="rack-head">
                          <strong>{pos}号架</strong>
                          <span className="muted">{r.used}/{cap}</span>
                        </div>
                        <div className="rack-owner">{r.owner_name ? `${r.owner_name}${mine ? "（我的）" : ""}` : <span className="muted">未分配</span>}</div>
                        <div className="usage"><span style={{ width: `${Math.min(100, (r.used / cap) * 100)}%` }} /></div>
                        {isAdmin && !readOnly && (
                          <button className="link" style={{ marginTop: 4 }} onClick={(e) => { e.stopPropagation(); onRack(r); }}>分配 / 设置</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {shelfLoose.length > 0 && (
                <div className="loose">
                  {shelfRacks.length > 0 && <span className="muted">不在架子格位上：</span>}
                  {shelfLoose.map((c) => (
                    <button key={c.id} className={`chip${c.id === containerId ? " selected" : ""}`} onClick={() => { setContainerId(c.id === containerId ? null : c.id); setRackId(null); setMoving(null); }}>
                      {c.is_shared && <span className="tag">公共</span>}
                      {KIND_LABELS[c.kind]}「{c.name}」{c.rack_no ? ` · ${c.rack_no}号架位` : ""} · {c.sample_count} 管
                    </button>
                  ))}
                </div>
              )}
              {!showSlots && !shelfLoose.length && <div className="muted" style={{ padding: "8px 0" }}>这一层没有架子，也没有登记盒子/框</div>}
            </div>
          </div>
        );
      })}

      {error && <div className="error">{error}</div>}

      {rack && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>第 {rack.shelf_no} 层 · {rack.position}号架</h2>
            <span className="muted">
              {rack.owner_name ? `分配给 ${rack.owner_name}` : "未分配"} · 架内 {rack.tiers} 层 × 每层 {rack.depth} 盒
              {rack.remarks && ` · ${rack.remarks}`}
            </span>
          </div>
          {!canSee(rack) ? (
            <p className="muted" style={{ marginTop: 12 }}>
              {rack.owner_id === null ? "这个架子还没有分配，需要使用请联系管理员。" : "这是别人的架子，只显示占用数量，不显示内容。"}
            </p>
          ) : (
            <RackGrid
              rack={rack}
              boxes={containers.filter((c) => inRack(c, rack) && c.tier_no !== null)}
              canUse={canUse(rack)}
              moving={moving}
              selectedId={containerId}
              onEmpty={(t, d) => clickEmpty(rack, t, d)}
              onBox={(c) => { setContainerId(c.id === containerId ? null : c.id); setMoving(null); }}
            />
          )}
          {canSee(rack) && (() => {
            const pending = containers.filter((c) => inRack(c, rack) && c.tier_no === null);
            if (!pending.length) return null;
            return (
              <div className="notice warn" style={{ marginTop: 12 }}>
                以下盒子登记在这个架子上，但还没有具体格位：
                {pending.map((c) => (
                  <span key={c.id} style={{ marginLeft: 8 }}>
                    「{c.name}」
                    {canUse(rack) && <button className="link" onClick={() => { setMoving(c); setContainerId(null); }}>点这里，再点一个空格放进去</button>}
                  </span>
                ))}
              </div>
            );
          })()}
          {moving && (
            <div className="notice" style={{ marginTop: 12 }}>
              正在给「{moving.name}」选新格位：请点上面的一个空格。<button className="link" onClick={() => setMoving(null)}>取消</button>
            </div>
          )}
        </div>
      )}

      {selected && (
        <ContainerPanel
          c={selected}
          userId={userId}
          isAdmin={isAdmin}
          readOnly={readOnly}
          onStore={() => onStore({ containerId: String(selected.id) })}
          onEdit={() => onEditContainer(selected)}
          onMove={() => { setMoving(selected); setContainerId(null); }}
          onShowSamples={() => onShowSamples(selected)}
        />
      )}
    </div>
  );
}

function RackGrid({ rack, boxes, canUse, moving, selectedId, onEmpty, onBox }: {
  rack: Rack; boxes: Container[]; canUse: boolean; moving: Container | null; selectedId: number | null;
  onEmpty: (tier: number, depth: number) => void; onBox: (c: Container) => void;
}) {
  const tiers = Array.from({ length: rack.tiers }, (_, i) => i + 1);
  const depths = Array.from({ length: rack.depth }, (_, i) => i + 1);
  return (
    <div className="rack-grid-wrap">
      <div className="rack-grid" style={{ gridTemplateColumns: `72px repeat(${rack.depth}, minmax(96px, 1fr))` }}>
        <div />
        {depths.map((d) => <div key={d} className="muted grid-head">第 {d} 盒{d === 1 ? "（最外）" : d === rack.depth ? "（最里）" : ""}</div>)}
        {tiers.map((t) => (
          <div key={t} style={{ display: "contents" }}>
            <div className="muted grid-head">架内第 {t} 层</div>
            {depths.map((d) => {
              const box = boxes.find((b) => b.tier_no === t && b.depth_no === d);
              if (box) {
                return (
                  <button key={d} className={`cell box${box.id === selectedId ? " selected" : ""}`} onClick={() => onBox(box)} title={box.remarks || undefined}>
                    <span className="cell-name">{box.name}</span>
                    <span className="muted">{box.sample_count} 管</span>
                  </button>
                );
              }
              return canUse ? (
                <button key={d} className={`cell empty can${moving ? " target" : ""}`} onClick={() => onEmpty(t, d)}>
                  {moving ? "放到这里" : "＋ 放盒子"}
                </button>
              ) : (
                <div key={d} className="cell empty" />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// 选中盒子/框后的详情：样品清单 + 操作
function ContainerPanel({ c, userId, isAdmin, readOnly, onStore, onEdit, onMove, onShowSamples }: {
  c: Container; userId: number; isAdmin: boolean; readOnly: boolean;
  onStore: () => void; onEdit: () => void; onMove: () => void; onShowSamples: () => void;
}) {
  // 结果带上对应的盒子与在库数，换了盒子或数量变化时视为未加载
  const key = `${c.id}-${c.sample_count}-${readOnly}`;
  const [loaded, setLoaded] = useState<{ key: string; samples: Sample[] } | null>(null);
  const samples = loaded?.key === key ? loaded.samples : null;
  const mine = c.owner_id === userId;
  const canStore = !readOnly && (mine || c.is_shared);
  const canEdit = !readOnly && (mine || (c.is_shared && isAdmin));

  useEffect(() => {
    const sp = new URLSearchParams({ container: String(c.id), status: "stored" });
    if (readOnly) sp.set("scope", "all");
    api<{ samples: Sample[] }>(`/api/v1/freezer/samples?${sp}`).then(
      (d) => setLoaded({ key, samples: d.samples }),
      () => setLoaded({ key, samples: [] })
    );
  }, [key, c.id, readOnly]);

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{KIND_LABELS[c.kind]}「{c.name}」</h2>
        {c.is_shared && <span className="tag">公共</span>}
        <span className="muted">
          {c.tier_no && c.depth_no ? `${c.rack_no}号架 ${rackCellLabel(c.tier_no, c.depth_no)}` : `第 ${c.shelf_no} 层`} · {c.owner_name} 建 · 在库 {c.sample_count} 管
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        {canStore && <button className="primary" onClick={onStore}>存入样品</button>}
        {canEdit && c.tier_no !== null && <button onClick={onMove}>换格位</button>}
        {canEdit && <button onClick={onEdit}>编辑</button>}
        <button onClick={onShowSamples}>{readOnly ? "在列表中查看" : "取出 / 转移…"}</button>
      </div>
      {c.remarks && <p className="muted">备注：{c.remarks}</p>}
      {samples === null ? (
        <p className="muted">加载中…</p>
      ) : !samples.length ? (
        <p className="muted">里面没有在库样品。</p>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 280, overflowY: "auto" }}>
          <table>
            <thead><tr><th>样品信息</th><th>项目号</th><th>样品类型</th><th>备注</th><th>存入日期</th>{(c.is_shared || readOnly) && <th>存放人</th>}</tr></thead>
            <tbody>
              {samples.map((s) => (
                <tr key={s.id}>
                  <td className="text-col">{s.name}</td><td>{s.project_no}</td><td>{s.sample_type}</td><td className="text-col">{s.remarks}</td>
                  <td className="nw">{s.stored_on}</td>
                  {(c.is_shared || readOnly) && <td className="nw">{s.owner_name}{s.owner_id === userId && "（我）"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
