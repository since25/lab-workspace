import { HttpError } from "./http";
import type { SessionUser } from "./auth";
import { parseCsv } from "./imports/sheet";
import type { PoolClient } from "pg";
import type { MaterialQuery } from "./materials-list";

export type CustomBatch = {
  id: number;
  user_id: number;
  batch_name: string;
  headers: string[];
  row_count: number;
  created_at: string;
};

export type CustomItem = {
  id: number;
  batch_id: number;
  user_id: number;
  title: string;
  data: Record<string, string>;
  row_idx: number;
  created_at: string;
};

export async function parseAndSaveCustomCsv(
  client: PoolClient,
  user: SessionUser,
  batchName: string,
  csvText: string
): Promise<CustomBatch> {
  const cleanText = csvText.replace(/^\uFEFF/, "").trim();
  if (!cleanText) throw new HttpError(400, "上传的 CSV 内容为空");
  const rawRows = parseCsv(cleanText);
  if (!rawRows.length) throw new HttpError(400, "未能识别到有效 CSV 表头");

  // 首行为表头
  const rawHeader = rawRows[0].map((c) => String(c ?? "").trim());
  const headers: string[] = [];
  const headerSet = new Set<string>();
  for (let i = 0; i < rawHeader.length; i++) {
    let name = rawHeader[i] || `列${i + 1}`;
    if (headerSet.has(name)) {
      name = `${name}_${i + 1}`;
    }
    headerSet.add(name);
    headers.push(name);
  }
  if (!headers.length) throw new HttpError(400, "CSV 必须至少包含一列表头");

  // 数据行
  const dataRows = rawRows.slice(1).filter((r) => r.some((c) => c !== null && String(c).trim() !== ""));
  if (!dataRows.length) throw new HttpError(400, "CSV 不包含任何有效数据行");
  if (dataRows.length > 500) throw new HttpError(400, "单批次最多支持 500 行数据");

  const name = (batchName || "").trim() || `批次-${new Date().toISOString().slice(0, 10)}`;
  const res = await client.query<CustomBatch>(
    `INSERT INTO label_custom_batches(user_id, batch_name, headers, row_count)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, batch_name, headers, row_count, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at`,
    [user.id, name, JSON.stringify(headers), dataRows.length]
  );
  const batch = res.rows[0];

  for (let idx = 0; idx < dataRows.length; idx++) {
    const r = dataRows[idx];
    const rowObj: Record<string, string> = {};
    headers.forEach((h, colIdx) => {
      rowObj[h] = String(r[colIdx] ?? "").trim();
    });
    const title = String(r[0] ?? "").trim() || `样本-${idx + 1}`;
    await client.query(
      `INSERT INTO label_custom_items(batch_id, user_id, title, data, row_idx)
       VALUES ($1, $2, $3, $4, $5)`,
      [batch.id, user.id, title, JSON.stringify(rowObj), idx + 1]
    );
  }

  return batch;
}

export async function listCustomBatches(db: MaterialQuery, user: SessionUser): Promise<CustomBatch[]> {
  const where = user.role === "admin" ? "true" : "user_id = $1";
  const params = user.role === "admin" ? [] : [user.id];
  return db<CustomBatch>(
    `SELECT id, user_id, batch_name, headers, row_count, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
       FROM label_custom_batches
      WHERE ${where}
      ORDER BY id DESC LIMIT 50`,
    params
  );
}

export async function getCustomBatch(db: MaterialQuery, batchId: number, user: SessionUser): Promise<CustomBatch | null> {
  const where = user.role === "admin" ? "id = $1" : "id = $1 AND user_id = $2";
  const params = user.role === "admin" ? [batchId] : [batchId, user.id];
  const [row] = await db<CustomBatch>(
    `SELECT id, user_id, batch_name, headers, row_count, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
       FROM label_custom_batches
      WHERE ${where}`,
    params
  );
  return row ?? null;
}
