import { query } from "@/lib/db";

// 健康检查（无需登录）：数据库与分析服务是否可用，不返回任何业务数据
export async function GET() {
  const db = await query("SELECT 1").then(() => true, () => false);
  const r = await fetch((process.env.R_ENGINE_URL || "http://127.0.0.1:8001") + "/api/health", { cache: "no-store" }).then(
    (res) => res.ok,
    () => false
  );
  return Response.json({ status: db && r ? "ok" : "degraded", db, r_engine: r }, { status: db ? 200 : 503 });
}
