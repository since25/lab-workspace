// 按文件名顺序执行 db/migrations/*.sql，已执行过的跳过。
// 用法：node scripts/migrate.mjs（读取 DATABASE_URL）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.MIGRATIONS_DIR || path.resolve(here, "../../../db/migrations");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
  );
  const done = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [f]);
      await client.query("COMMIT");
      console.log(`已执行 ${f}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`${f} 执行失败：${e.message}`);
    }
  }
  console.log("数据库结构已是最新");
} finally {
  await client.end();
}
