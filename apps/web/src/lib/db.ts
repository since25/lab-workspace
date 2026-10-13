import { Pool, type PoolClient } from "pg";

// 全局复用一个连接池（开发模式热更新时避免重复创建）
const g = globalThis as unknown as { __labPool?: Pool };
export const pool = g.__labPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
g.__labPool = pool;

export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function withTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
