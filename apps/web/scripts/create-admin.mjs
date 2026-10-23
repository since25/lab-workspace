// 创建或重置管理员账号。
// 用法：node scripts/create-admin.mjs <用户名> <显示名>，密码从环境变量 ADMIN_PASSWORD 读取（不进命令行历史）
import pg from "pg";
import bcrypt from "bcryptjs";

const [username, displayName] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD || "";
if (!username || !displayName || password.length < 8) {
  console.error("用法：ADMIN_PASSWORD=<至少8位> node scripts/create-admin.mjs <用户名> <显示名>");
  process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const hash = await bcrypt.hash(password, 12);
  await client.query(
    `INSERT INTO users(username, display_name, password_hash, role, tenant_id)
     VALUES ($1, $2, $3, 'admin', (SELECT id FROM tenants WHERE slug = 'default'))
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, role = 'admin', is_active = true,
           failed_attempts = 0, locked_until = NULL, updated_at = now()`,
    [username, displayName, hash]
  );
  await client.query(
    "INSERT INTO audit_logs(action, resource_type, resource_id) VALUES ('admin.bootstrap', 'user', $1)",
    [username]
  );
  console.log(`管理员 ${username} 已就绪`);
} finally {
  await client.end();
}
