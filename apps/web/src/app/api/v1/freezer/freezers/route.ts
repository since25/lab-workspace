import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { parseFreezerInput } from "@/lib/freezer-server";
import { HttpError, handle, ok, readJson } from "@/lib/http";

// 冰箱清单：所有登录用户可读（停用的只有管理员能看到）；增改仅管理员
export const GET = handle(async () => {
  const user = await requireUser();
  const freezers = await query(
    `SELECT id, name, temperature, location, remarks, is_active FROM freezers
      ${user.role === "admin" ? "" : "WHERE is_active"}
      ORDER BY temperature::int, name`
  );
  return ok({ freezers });
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser("admin");
  const f = parseFreezerInput(await readJson(req));
  const [dup] = await query("SELECT 1 FROM freezers WHERE name = $1", [f.name]);
  if (dup) throw new HttpError(409, "已有同名冰箱");
  const [row] = await query<{ id: number }>(
    "INSERT INTO freezers(name, temperature, location, remarks, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [f.name, f.temperature, f.location, f.remarks, f.is_active]
  );
  await audit(user.id, "freezer.create", "freezer", row.id, { name: f.name, temperature: f.temperature }, req);
  return ok({ id: row.id }, 201);
});
