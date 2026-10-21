import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { ok } from "@/lib/http";
import { listLinks } from "@/lib/consumable-stock";
import { materialHandle } from "@/lib/materials-http";

// 核对工作台列表（管理员）：view=pending|inbound|done。
export const GET = materialHandle(async (req: Request) => {
  await requireUser("admin");
  return ok(await listLinks(query, new URL(req.url).searchParams));
});
