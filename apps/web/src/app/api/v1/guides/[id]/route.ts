import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { parseGuide } from "@/lib/guides";
import { HttpError, handle, ok, readJson } from "@/lib/http";

// 只能操作自己的 Guide：所有语句都带 owner_id 条件
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/v1/guides/[id]">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const g = parseGuide(await readJson(req));
  try {
    const rows = await query(
      `UPDATE guides SET name=$3, target=$4, sequence=$5, pam=$6, strand=$7, target_position=$8,
              target_base=$9, edited_base=$10, notes=$11, bystander_position=$12, updated_at=now()
        WHERE id=$1 AND owner_id=$2 RETURNING *`,
      [Number(id), user.id, g.name, g.target, g.sequence, g.pam, g.strand, g.target_position, g.target_base, g.edited_base, g.notes, g.bystander_position]
    );
    if (!rows[0]) throw new HttpError(404, "Guide 不存在");
    await audit(user.id, "guide.update", "guide", id, {}, req);
    return ok({ guide: rows[0] });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "已有同名 Guide");
    throw e;
  }
});

export const DELETE = handle(async (req: Request, ctx: RouteContext<"/api/v1/guides/[id]">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const rows = await query("DELETE FROM guides WHERE id=$1 AND owner_id=$2 RETURNING id", [Number(id), user.id]);
  if (!rows[0]) throw new HttpError(404, "Guide 不存在");
  await audit(user.id, "guide.delete", "guide", id, {}, req);
  return ok({ ok: true });
});
