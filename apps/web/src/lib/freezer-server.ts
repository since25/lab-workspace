import type { PoolClient } from "pg";
import { audit } from "./audit";
import { canViewAllFreezer, type SessionUser } from "./auth";
import { query } from "./db";
import { HttpError, str } from "./http";
import { TEMPERATURES } from "./freezer";

// 查询范围：管理员或有「冰箱总览」权限的成员带 scope=all 时可只读查看全部人员，其余情况只看自己的。
// 返回 null 表示不按归属过滤。
export function ownerFilter(user: SessionUser, sp: URLSearchParams): number | null {
  if (sp.get("scope") === "all") {
    if (!canViewAllFreezer(user)) throw new HttpError(403, "没有查看全部冰箱内容的权限");
    const owner = Number(str(sp.get("owner")));
    return Number.isInteger(owner) && owner > 0 ? owner : null;
  }
  return user.id;
}

// 容器 + 冰箱信息（用于拼位置）
export const CONTAINER_SQL = `
  SELECT ct.id, ct.owner_id, ct.freezer_id, ct.kind, ct.name, ct.shelf_no, ct.rack_no, ct.slot_no, ct.tier_no, ct.depth_no,
         ct.is_shared, ct.remarks, f.name AS freezer_name, f.temperature, u.display_name AS owner_name
    FROM freezer_containers ct
    JOIN freezers f ON f.id = ct.freezer_id
    JOIN users u ON u.id = ct.owner_id`;

function optInt(v: unknown, label: string): number | null {
  const s = str(v);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `${label}必须是 1 以上的整数`);
  return n;
}

export function parseFreezerInput(body: Record<string, unknown>) {
  const name = str(body.name);
  if (!name) throw new HttpError(400, "冰箱名称不能为空");
  const temperature = str(body.temperature);
  if (!(TEMPERATURES as readonly string[]).includes(temperature)) throw new HttpError(400, "温度只能是 -80、-20 或 4");
  // 布局（选填）：总层数与每层架子数要么都填、要么都不填
  const shelf_count = optInt(body.shelf_count, "总层数");
  const racks_per_shelf = optInt(body.racks_per_shelf, "每层架子数");
  if ((shelf_count === null) !== (racks_per_shelf === null)) throw new HttpError(400, "布局的总层数和每层架子数要同时填写，或都不填");
  if ((shelf_count ?? 0) > 20 || (racks_per_shelf ?? 0) > 20) throw new HttpError(400, "层数和每层架子数不能超过 20");
  return {
    name, temperature, location: str(body.location), remarks: str(body.remarks), is_active: body.is_active !== false,
    shelf_count, racks_per_shelf,
  };
}

export interface ContainerInput {
  freezer_id: number;
  kind: string;
  name: string;
  shelf_no: number;
  rack_no: number | null;
  slot_no: number | null;
  tier_no: number | null;
  depth_no: number | null;
  is_shared: boolean;
  remarks: string;
}

// isAdmin：只有管理员能把容器设为公共（is_shared）
export function parseContainerInput(body: Record<string, unknown>, isAdmin = false): ContainerInput {
  const freezer_id = Number(str(body.freezer_id));
  if (!Number.isInteger(freezer_id) || freezer_id < 1) throw new HttpError(400, "请选择冰箱");
  const kind = str(body.kind);
  if (kind !== "box" && kind !== "basket") throw new HttpError(400, "类型只能是盒子或框");
  const name = str(body.name);
  if (!name) throw new HttpError(400, "盒子/框名称不能为空");
  const shelf_no = optInt(body.shelf_no, "层");
  if (shelf_no === null) throw new HttpError(400, "请填写第几层");
  const rack_no = optInt(body.rack_no, "架号");
  const tier_no = optInt(body.tier_no, "架内层");
  const depth_no = optInt(body.depth_no, "盒位");
  if ((tier_no === null) !== (depth_no === null)) throw new HttpError(400, "架内第几层和第几个盒位要同时填写");
  if (tier_no !== null && rack_no === null) throw new HttpError(400, "放进架子格位时请选择架子");
  if (tier_no !== null && kind !== "box") throw new HttpError(400, "架子格位里只能放盒子");
  return {
    freezer_id, kind, name, shelf_no, rack_no, tier_no, depth_no,
    // 放进架子格位时不再使用旧的「架内格位」
    slot_no: tier_no === null ? optInt(body.slot_no, "架内格位") : null,
    is_shared: isAdmin && body.is_shared === true,
    remarks: str(body.remarks),
  };
}

// 位置是否相同（用于修改时判断是否搬动了位置）
export const samePlace = (a: Record<string, unknown>, b: ContainerInput) =>
  (["freezer_id", "shelf_no", "rack_no", "tier_no", "depth_no"] as const).every((k) => String(a[k] ?? "") === String(b[k] ?? ""));

// 校验冰箱存在且启用。
// 设置了布局的冰箱：层号、架号不能超出布局；放进已登记的架子（指定架号）时，架子必须分配给本人；
// 指定架内格位时格位不能超出架子、不能已有盒子。moved=false（修改时没搬位置）跳过这些检查。
// 其他冰箱：同一位置（冰箱/层/架/格都填写时）已有其他盒子则返回提示，不阻止保存。提示不透露对方是谁、放了什么。
export async function checkContainerPlace(
  c: PoolClient, user: SessionUser, input: ContainerInput, selfId?: number, moved = true
): Promise<string> {
  const f = (await c.query("SELECT is_active, shelf_count, racks_per_shelf FROM freezers WHERE id = $1", [input.freezer_id])).rows[0];
  if (!f) throw new HttpError(400, "冰箱不存在");
  if (!f.is_active) throw new HttpError(400, "该冰箱已停用，请选择其他冰箱");
  if (!moved) return "";
  if (f.shelf_count) {
    if (input.shelf_no > f.shelf_count) throw new HttpError(400, `这台冰箱只有 ${f.shelf_count} 层`);
    if (input.rack_no !== null && input.rack_no > f.racks_per_shelf) throw new HttpError(400, `这台冰箱每层只有 ${f.racks_per_shelf} 个架位`);
  }
  if (input.rack_no !== null) {
    const rack = (
      await c.query("SELECT owner_id, tiers, depth FROM freezer_racks WHERE freezer_id = $1 AND shelf_no = $2 AND position = $3", [
        input.freezer_id, input.shelf_no, input.rack_no,
      ])
    ).rows[0];
    if (rack && rack.owner_id !== user.id) throw new HttpError(403, "这个架子没有分配给你，不能往里放。需要架子请联系管理员分配。");
    if (input.tier_no !== null) {
      if (!rack) throw new HttpError(400, "该位置还没有架子，请联系管理员添加");
      if (input.tier_no > rack.tiers || input.depth_no! > rack.depth) throw new HttpError(400, `这个架子是 ${rack.tiers} 层 × 每层 ${rack.depth} 盒，格位超出范围`);
      const taken = await c.query(
        `SELECT 1 FROM freezer_containers WHERE freezer_id = $1 AND shelf_no = $2 AND rack_no = $3 AND tier_no = $4 AND depth_no = $5 AND id <> $6`,
        [input.freezer_id, input.shelf_no, input.rack_no, input.tier_no, input.depth_no, selfId ?? 0]
      );
      if (taken.rowCount) throw new HttpError(409, "这个格位已经有盒子了，请换一个空格位");
      return "";
    }
  }
  if (input.kind !== "box" || input.rack_no === null || input.slot_no === null) return "";
  const r = await c.query(
    `SELECT 1 FROM freezer_containers
      WHERE freezer_id = $1 AND shelf_no = $2 AND rack_no = $3 AND slot_no = $4 AND kind = 'box' AND id <> $5 LIMIT 1`,
    [input.freezer_id, input.shelf_no, input.rack_no, input.slot_no, selfId ?? 0]
  );
  return r.rowCount ? "提示：该位置已登记了其他盒子，请核对实际位置。" : "";
}

export async function insertContainer(c: PoolClient, ownerId: number, input: ContainerInput): Promise<number> {
  const r = await c.query<{ id: number }>(
    `INSERT INTO freezer_containers(owner_id, freezer_id, kind, name, shelf_no, rack_no, slot_no, tier_no, depth_no, is_shared, remarks)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [ownerId, input.freezer_id, input.kind, input.name, input.shelf_no, input.rack_no, input.slot_no, input.tier_no, input.depth_no,
      input.is_shared, input.remarks]
  );
  return r.rows[0].id;
}

// 目标容器：body.new_container 时新建（同一事务），否则取 body.container_id 指定的自己的容器或公共容器
export async function resolveTargetContainer(c: PoolClient, user: SessionUser, body: Record<string, unknown>, req: Request) {
  let id = Number(body.container_id);
  let warning = "";
  if (body.new_container && typeof body.new_container === "object") {
    const input = parseContainerInput(body.new_container as Record<string, unknown>, user.role === "admin");
    warning = await checkContainerPlace(c, user, input);
    id = await insertContainer(c, user.id, input);
    await audit(user.id, "freezer_container.create", "freezer_container", id, { ...input }, req, c);
  }
  if (!id) throw new HttpError(400, "请选择盒子/框");
  const r = await c.query(`${CONTAINER_SQL} WHERE ct.id = $1 AND (ct.owner_id = $2 OR ct.is_shared) FOR UPDATE OF ct`, [id, user.id]);
  if (!r.rows[0]) throw new HttpError(404, "盒子/框不存在");
  return { container: r.rows[0] as Record<string, unknown> & { id: number; name: string }, warning };
}

// 取可修改的容器（加锁）：自己的，或管理员修改公共容器；其余都按不存在处理
export async function ownContainer(c: PoolClient, user: SessionUser, id: number) {
  const r = await c.query(
    `${CONTAINER_SQL} WHERE ct.id = $1 AND (ct.owner_id = $2 OR (ct.is_shared AND $3)) FOR UPDATE OF ct`,
    [id, user.id, user.role === "admin"]
  );
  if (!r.rows[0]) throw new HttpError(404, "盒子/框不存在");
  return r.rows[0] as Record<string, unknown> & { id: number; name: string };
}

export const SAMPLE_FIELDS = ["name", "project_no", "sample_type", "remarks"] as const;
export type SampleField = (typeof SAMPLE_FIELDS)[number];

export function parseSampleInput(body: Record<string, unknown>, partial: boolean): Partial<Record<SampleField, string>> {
  const out: Partial<Record<SampleField, string>> = {};
  for (const k of SAMPLE_FIELDS) {
    if (partial && !Object.prototype.hasOwnProperty.call(body, k)) continue;
    out[k] = str(body[k]);
  }
  if ("name" in out && !out.name) throw new HttpError(400, "样品信息不能为空");
  return out;
}

// 架子的可修改项：分配给谁（可空 = 未分配）、架内层数、每层盒位数、备注
export function parseRackInput(body: Record<string, unknown>) {
  const owner = str(body.owner_id);
  const owner_id = owner ? Number(owner) : null;
  if (owner_id !== null && (!Number.isInteger(owner_id) || owner_id < 1)) throw new HttpError(400, "分配对象不正确");
  const dim = (v: unknown, label: string, def: number) => {
    const n = str(v) === "" ? def : Number(str(v));
    if (!Number.isInteger(n) || n < 1 || n > 20) throw new HttpError(400, `${label}必须是 1–20 的整数`);
    return n;
  };
  return { owner_id, tiers: dim(body.tiers, "架内层数", 5), depth: dim(body.depth, "每层盒位数", 4), remarks: str(body.remarks) };
}

// 架子只能分配给启用中的账号
export async function checkRackOwner(ownerId: number | null) {
  if (ownerId === null) return;
  const [u] = await query("SELECT 1 FROM users WHERE id = $1 AND is_active", [ownerId]);
  if (!u) throw new HttpError(400, "分配对象不存在或已停用");
}
