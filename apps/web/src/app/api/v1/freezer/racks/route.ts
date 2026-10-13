import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { checkRackOwner, parseRackInput } from "@/lib/freezer-server";
import { HttpError, handle, ok, readJson, str } from "@/lib/http";

// 某台冰箱的架子：所有登录用户可看位置、分配给谁、用了几个盒位（不含盒子内容）；增改删仅管理员
export const GET = handle(async (req: Request) => {
  await requireUser();
  const freezer = Number(str(new URL(req.url).searchParams.get("freezer")));
  if (!freezer) throw new HttpError(400, "请指定冰箱");
  const racks = await query(
    `SELECT r.id, r.freezer_id, r.shelf_no, r.position, r.owner_id, u.display_name AS owner_name, r.tiers, r.depth, r.remarks,
            (SELECT count(*)::int FROM freezer_containers ct
              WHERE ct.freezer_id = r.freezer_id AND ct.shelf_no = r.shelf_no AND ct.rack_no = r.position AND ct.tier_no IS NOT NULL) AS used
       FROM freezer_racks r LEFT JOIN users u ON u.id = r.owner_id
      WHERE r.freezer_id = $1 ORDER BY r.shelf_no, r.position`,
    [freezer]
  );
  return ok({ racks });
});

// 放置架子：{freezer_id, shelf_no, position, owner_id?, tiers?, depth?, remarks?}
export const POST = handle(async (req: Request) => {
  const user = await requireUser("admin");
  const body = await readJson(req);
  const freezerId = Number(str(body.freezer_id));
  const shelf = Number(str(body.shelf_no));
  const position = Number(str(body.position));
  const [f] = await query<{ shelf_count: number | null; racks_per_shelf: number | null }>(
    "SELECT shelf_count, racks_per_shelf FROM freezers WHERE id = $1",
    [freezerId]
  );
  if (!f) throw new HttpError(400, "冰箱不存在");
  if (!f.shelf_count || !f.racks_per_shelf) throw new HttpError(400, "请先在「管理冰箱」里给这台冰箱设置布局");
  if (!Number.isInteger(shelf) || shelf < 1 || shelf > f.shelf_count) throw new HttpError(400, "层号超出布局");
  if (!Number.isInteger(position) || position < 1 || position > f.racks_per_shelf) throw new HttpError(400, "架位超出布局");
  const input = parseRackInput(body);
  await checkRackOwner(input.owner_id);
  const [dup] = await query("SELECT 1 FROM freezer_racks WHERE freezer_id = $1 AND shelf_no = $2 AND position = $3", [freezerId, shelf, position]);
  if (dup) throw new HttpError(409, "这个位置已经有架子了");
  const [row] = await query<{ id: number }>(
    `INSERT INTO freezer_racks(freezer_id, shelf_no, position, owner_id, tiers, depth, remarks)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [freezerId, shelf, position, input.owner_id, input.tiers, input.depth, input.remarks]
  );
  await audit(user.id, "freezer_rack.create", "freezer_rack", row.id, { freezer_id: freezerId, shelf_no: shelf, position, ...input }, req);
  return ok({ id: row.id }, 201);
});
