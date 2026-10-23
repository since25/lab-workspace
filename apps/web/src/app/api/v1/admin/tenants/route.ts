import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, HttpError, ok, readJson, str } from "@/lib/http";

export const GET = handle(async () => {
  await requireUser("admin");
  return ok({ tenants: await query("SELECT id, slug, name, is_active, label_print_enabled, created_at FROM tenants ORDER BY name, id") });
});

export const POST = handle(async (req: Request) => {
  const admin = await requireUser("admin");
  const body = await readJson(req);
  const slug = str(body.slug).toLowerCase();
  const name = str(body.name);
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug)) throw new HttpError(400, "租户标识只能用 2–49 位小写字母、数字或短横线");
  if (!name || name.length > 100) throw new HttpError(400, "租户名称不能为空且不能超过 100 字");
  try {
    const [tenant] = await query<{ id: number; slug: string; name: string; is_active: boolean; label_print_enabled: boolean }>("INSERT INTO tenants(slug,name,is_active,label_print_enabled) VALUES ($1,$2,true,$3) RETURNING id,slug,name,is_active,label_print_enabled", [slug, name, body.label_print_enabled === true]);
    await audit(admin.id, "admin.tenant_create", "tenant", tenant.id, { slug, name, label_print_enabled: body.label_print_enabled === true }, req);
    return ok({ tenant }, 201);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "租户标识已存在");
    throw e;
  }
});
