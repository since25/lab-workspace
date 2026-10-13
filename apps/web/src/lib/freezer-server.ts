import type { PoolClient } from "pg";
import { audit } from "./audit";
import { canViewAllFreezer, type SessionUser } from "./auth";
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
  SELECT ct.id, ct.owner_id, ct.freezer_id, ct.kind, ct.name, ct.shelf_no, ct.rack_no, ct.slot_no, ct.remarks,
         f.name AS freezer_name, f.temperature, u.display_name AS owner_name
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
  return { name, temperature, location: str(body.location), remarks: str(body.remarks), is_active: body.is_active !== false };
}

export interface ContainerInput {
  freezer_id: number;
  kind: string;
  name: string;
  shelf_no: number;
  rack_no: number | null;
  slot_no: number | null;
  remarks: string;
}

export function parseContainerInput(body: Record<string, unknown>): ContainerInput {
  const freezer_id = Number(str(body.freezer_id));
  if (!Number.isInteger(freezer_id) || freezer_id < 1) throw new HttpError(400, "请选择冰箱");
  const kind = str(body.kind);
  if (kind !== "box" && kind !== "basket") throw new HttpError(400, "容器类型只能是盒子或框");
  const name = str(body.name);
  if (!name) throw new HttpError(400, "容器名称不能为空");
  const shelf_no = optInt(body.shelf_no, "层");
  if (shelf_no === null) throw new HttpError(400, "请填写第几层");
  return {
    freezer_id, kind, name, shelf_no,
    rack_no: optInt(body.rack_no, "架号"),
    slot_no: optInt(body.slot_no, "架内格位"),
    remarks: str(body.remarks),
  };
}

// 校验冰箱存在且启用；同一位置（冰箱/层/架/格都填写时）已有其他盒子则返回提示，不阻止保存。
// 提示不透露对方是谁、放了什么。
export async function checkContainerPlace(c: PoolClient, input: ContainerInput, selfId?: number): Promise<string> {
  const f = (await c.query("SELECT is_active FROM freezers WHERE id = $1", [input.freezer_id])).rows[0];
  if (!f) throw new HttpError(400, "冰箱不存在");
  if (!f.is_active) throw new HttpError(400, "该冰箱已停用，请选择其他冰箱");
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
    `INSERT INTO freezer_containers(owner_id, freezer_id, kind, name, shelf_no, rack_no, slot_no, remarks)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [ownerId, input.freezer_id, input.kind, input.name, input.shelf_no, input.rack_no, input.slot_no, input.remarks]
  );
  return r.rows[0].id;
}

// 目标容器：body.new_container 时新建（同一事务），否则取 body.container_id 指定的自己的容器
export async function resolveTargetContainer(c: PoolClient, user: SessionUser, body: Record<string, unknown>, req: Request) {
  let id = Number(body.container_id);
  let warning = "";
  if (body.new_container && typeof body.new_container === "object") {
    const input = parseContainerInput(body.new_container as Record<string, unknown>);
    warning = await checkContainerPlace(c, input);
    id = await insertContainer(c, user.id, input);
    await audit(user.id, "freezer_container.create", "freezer_container", id, { ...input }, req, c);
  }
  if (!id) throw new HttpError(400, "请选择容器");
  return { container: await ownContainer(c, user, id), warning };
}

// 取自己的容器（加锁）；不存在或不属于自己都按不存在处理
export async function ownContainer(c: PoolClient, user: SessionUser, id: number) {
  const r = await c.query(`${CONTAINER_SQL} WHERE ct.id = $1 AND ct.owner_id = $2 FOR UPDATE OF ct`, [id, user.id]);
  if (!r.rows[0]) throw new HttpError(404, "容器不存在");
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
