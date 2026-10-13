import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, ok, str } from "@/lib/http";

export const GET = handle(async (req: Request) => {
  await requireUser("admin");
  const sp = new URL(req.url).searchParams;
  const action = str(sp.get("action"));
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const params: unknown[] = [];
  let where = "";
  if (action) {
    params.push(`${action}%`);
    where = "WHERE a.action LIKE $1";
  }
  const logs = await query(
    `SELECT a.id, a.action, a.resource_type, a.resource_id, a.metadata_json, a.created_at, u.display_name AS actor
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${where}
      ORDER BY a.id DESC LIMIT 100 OFFSET ${(page - 1) * 100}`,
    params
  );
  return ok({ logs, page });
});
