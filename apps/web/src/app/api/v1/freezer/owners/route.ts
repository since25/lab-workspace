import { canViewAllFreezer, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { HttpError, handle, ok } from "@/lib/http";

// 全部人员视图的「存放人」筛选项：登记过容器的账号（仅管理员或有「冰箱总览」权限者）
export const GET = handle(async () => {
  const user = await requireUser();
  if (!canViewAllFreezer(user)) throw new HttpError(403, "没有查看全部冰箱内容的权限");
  const owners = await query(
    `SELECT u.id, u.display_name FROM users u
      WHERE EXISTS (SELECT 1 FROM freezer_containers ct WHERE ct.owner_id = u.id)
      ORDER BY u.display_name`
  );
  return ok({ owners });
});
