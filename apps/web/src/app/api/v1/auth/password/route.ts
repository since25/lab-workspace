import bcrypt from "bcryptjs";
import { audit } from "@/lib/audit";
import { hashPassword, requireUser, validatePassword } from "@/lib/auth";
import { query } from "@/lib/db";
import { HttpError, handle, ok, readJson } from "@/lib/http";

// 修改自己的密码
export const PATCH = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await readJson(req);
  const current = String(body.current_password ?? "");
  const next = String(body.new_password ?? "");
  const bad = validatePassword(next);
  if (bad) throw new HttpError(400, bad);
  const [row] = await query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [user.id]);
  if (!row || !(await bcrypt.compare(current, row.password_hash))) throw new HttpError(400, "当前密码不正确");
  await query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [user.id, await hashPassword(next)]);
  await audit(user.id, "auth.password_changed", "user", user.id, {}, req);
  return ok({ ok: true });
});
