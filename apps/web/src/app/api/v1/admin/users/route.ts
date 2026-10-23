import { audit } from "@/lib/audit";
import { hashPassword, requireUser, validatePassword } from "@/lib/auth";
import { query } from "@/lib/db";
import { HttpError, handle, ok, readJson, str } from "@/lib/http";

export const GET = handle(async () => {
  await requireUser("admin");
  const users = await query(
    `SELECT u.id, u.username, u.display_name, u.role, u.freezer_view_all, u.is_active, u.locked_until, u.created_at,
            u.tenant_id, t.name AS tenant_name
       FROM users u JOIN tenants t ON t.id = u.tenant_id ORDER BY u.is_active DESC, u.username`
  );
  return ok({ users });
});

export const POST = handle(async (req: Request) => {
  const admin = await requireUser("admin");
  const body = await readJson(req);
  const username = str(body.username);
  const display_name = str(body.display_name) || username;
  const role = str(body.role) || "member";
  const password = String(body.password ?? "");
  const freezerViewAll = body.freezer_view_all === true;
  const tenantId = Number(body.tenant_id);
  if (!/^[A-Za-z0-9._-]{2,32}$/.test(username)) throw new HttpError(400, "用户名只能用 2–32 位字母、数字、点、下划线或短横线");
  if (!["admin", "member"].includes(role)) throw new HttpError(400, "角色不正确");
  const bad = validatePassword(password);
  if (bad) throw new HttpError(400, bad);
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new HttpError(400, "请选择租户");
  try {
    const [u] = await query<{ id: number }>(
      "INSERT INTO users(username, display_name, password_hash, role, freezer_view_all, tenant_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [username, display_name, await hashPassword(password), role, freezerViewAll, tenantId]
    );
    await audit(admin.id, "admin.user_create", "user", u.id, { username, role, freezer_view_all: freezerViewAll }, req);
    return ok({ id: u.id }, 201);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "用户名已存在");
    throw e;
  }
});
