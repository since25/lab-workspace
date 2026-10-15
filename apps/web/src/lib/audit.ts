import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./db";

// 审计日志：metadata 不写序列、密码、原始文件内容
export async function audit(
  actorId: number | null,
  action: string,
  resourceType = "",
  resourceId: string | number = "",
  metadata: Record<string, unknown> = {},
  req?: Request,
  client?: Pick<PoolClient, "query">
) {
  const ip = req?.headers.get("x-forwarded-for")?.split(",")[0].trim() || "";
  const ipHash = ip ? createHash("sha256").update(ip + (process.env.SESSION_SECRET || "")).digest("hex").slice(0, 16) : "";
  await (client ?? pool).query(
    "INSERT INTO audit_logs(actor_id, action, resource_type, resource_id, metadata_json, ip_hash) VALUES ($1,$2,$3,$4,$5,$6)",
    [actorId, action, resourceType, String(resourceId), JSON.stringify(metadata), ipHash]
  );
}
