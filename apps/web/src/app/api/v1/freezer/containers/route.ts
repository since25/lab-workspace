import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { CONTAINER_SQL, checkContainerPlace, insertContainer, ownerFilter, parseContainerInput } from "@/lib/freezer-server";
import { handle, ok, readJson, str } from "@/lib/http";

// 容器列表（含在库样品数）；普通用户看自己的和公共的，管理员 scope=all 只读查看全部
export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const sp = new URL(req.url).searchParams;
  const owner = ownerFilter(user, sp);
  const where: string[] = [];
  const params: unknown[] = [];
  if (owner !== null) {
    params.push(owner);
    // 自己的视图里带上公共容器；全部人员视图按存放人筛选时只看该人的
    where.push(`(ct.owner_id = $${params.length}${sp.get("scope") === "all" ? "" : " OR ct.is_shared"})`);
  }
  const freezer = Number(str(sp.get("freezer")));
  if (freezer) {
    params.push(freezer);
    where.push(`ct.freezer_id = $${params.length}`);
  }
  const containers = await query(
    `SELECT x.*, (SELECT count(*)::int FROM freezer_samples s WHERE s.container_id = x.id AND s.status = 'stored') AS sample_count
       FROM (${CONTAINER_SQL} ${where.length ? "WHERE " + where.join(" AND ") : ""}) x
      ORDER BY x.temperature::int, x.freezer_name, x.shelf_no, x.rack_no NULLS LAST, x.tier_no NULLS LAST, x.depth_no NULLS LAST, x.slot_no NULLS LAST, x.name`,
    params
  );
  return ok({ containers });
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const input = parseContainerInput(await readJson(req), user.role === "admin");
  const result = await withTransaction(async (c) => {
    const warning = await checkContainerPlace(c, user, input);
    const id = await insertContainer(c, user.id, input);
    await audit(user.id, "freezer_container.create", "freezer_container", id, { ...input }, req, c);
    return { id, warning };
  });
  return ok(result, 201);
});
