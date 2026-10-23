import { audit } from "@/lib/audit";
import { hashPassword, requireUser, validatePassword } from "@/lib/auth";
import { query } from "@/lib/db";
import { HttpError, handle, ok, readJson, str } from "@/lib/http";

// 管理员修改账号：启用/停用、角色、「冰箱总览」权限、显示名、重置密码（重置时同时解锁）
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/v1/admin/users/[id]">) => {
  const admin = await requireUser("admin");
  const id = Number((await ctx.params).id);
  const body = await readJson(req);
  const sets: string[] = [];
  const vals: unknown[] = [id];
  const meta: Record<string, unknown> = {};
  const set = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };
  if (id === admin.id && (body.is_active === false || body.role === "member")) {
    throw new HttpError(400, "不能停用自己或取消自己的管理员权限");
  }
  if (typeof body.is_active === "boolean") {
    set("is_active", body.is_active);
    meta.is_active = body.is_active;
  }
  if (body.role !== undefined) {
    if (!["admin", "member"].includes(String(body.role))) throw new HttpError(400, "角色不正确");
    set("role", body.role);
    meta.role = body.role;
  }
  if (typeof body.freezer_view_all === "boolean") {
    set("freezer_view_all", body.freezer_view_all);
    meta.freezer_view_all = body.freezer_view_all;
  }
  if (typeof body.label_print_enabled === "boolean") {
    set("label_print_enabled", body.label_print_enabled);
    meta.label_print_enabled = body.label_print_enabled;
  }
  if (body.display_name !== undefined) {
    if (!str(body.display_name)) throw new HttpError(400, "显示名不能为空");
    set("display_name", str(body.display_name));
  }
  if (body.password !== undefined) {
    const bad = validatePassword(String(body.password));
    if (bad) throw new HttpError(400, bad);
    set("password_hash", await hashPassword(String(body.password)));
    sets.push("failed_attempts = 0", "locked_until = NULL");
    meta.password_reset = true;
  }
  if (!sets.length) throw new HttpError(400, "没有要修改的内容");
  const rows = await query(`UPDATE users SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING id`, vals);
  if (!rows[0]) throw new HttpError(404, "用户不存在");
  // 停用或重置密码后让该用户已有的登录失效
  if (body.is_active === false || body.password !== undefined) await query("DELETE FROM sessions WHERE user_id = $1", [id]);
  await audit(admin.id, "admin.user_update", "user", id, meta, req);
  return ok({ ok: true });
});
