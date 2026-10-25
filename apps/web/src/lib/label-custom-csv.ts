import { HttpError } from "./http";
import type { SessionUser } from "./auth";
import { isoDate, parseCsv, parseLooseDate, readWorkbook, type Cell } from "./imports/sheet";
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

// 行列索引从 0 开始，列索引始终对应原始工作表。
export type CustomImportOptions = {
  sheet?: string;
  header_row?: number;
  title_col?: number;
  columns?: { index: number; name: string; keep: boolean }[];
};

export type CustomImportPreview = {
  sheets: string[];
  sheet: string;
  header_row: number;
  title_col: number;
  columns: { index: number; name: string }[];
  rows_preview: string[][];
  total_rows: number;
};

type CustomSheet = { name: string; rows: Cell[][] };
type CustomImport = { preview: CustomImportPreview; headers: string[]; rows: string[][] };

export function decodeCustomText(buf: ArrayBuffer): string {
  let decoded: string;
  try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { decoded = new TextDecoder("gb18030").decode(buf); }
  return decoded.replace(/^\uFEFF/, "");
}

export function detectCustomDelimiter(src: string, pasted = false): string {
  const lines = src.split(/\r\n|\r|\n/).filter((line) => line.trim()).slice(0, 5);
  const candidates = ["\t", ",", ";"].map((delimiter) => {
    const counts = lines.map((line) => {
      let quoted = false;
      let count = 0;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') {
          if (quoted && line[i + 1] === '"') i++;
          else quoted = !quoted;
        } else if (!quoted && line[i] === delimiter) count++;
      }
      return count;
    });
    const positive = counts.filter((count) => count > 0);
    const frequency = positive.reduce((best, count) => Math.max(best, counts.filter((n) => n === count).length), 0);
    const mean = counts.reduce((sum, count) => sum + count, 0) / (counts.length || 1);
    const variance = counts.reduce((sum, count) => sum + (count - mean) ** 2, 0) / (counts.length || 1);
    return { delimiter, frequency, variance, mean };
  }).filter((candidate) => candidate.mean > 0);
  if (pasted && candidates.some((candidate) => candidate.delimiter === "\t")) return "\t";
  candidates.sort((a, b) => b.frequency - a.frequency || a.variance - b.variance || b.mean - a.mean);
  return candidates[0]?.delimiter ?? ",";
}

export function customTextSheets(src: string, name = "文本", pasted = false): CustomSheet[] {
  const clean = src.replace(/^\uFEFF/, "");
  return [{ name, rows: parseCsv(clean, detectCustomDelimiter(clean, pasted)) }];
}

export async function readCustomImport(buf: ArrayBuffer, filename: string): Promise<CustomSheet[]> {
  if (/\.xlsx$/i.test(filename)) return readWorkbook(buf, filename);
  return customTextSheets(decodeCustomText(buf), filename.replace(/\.[^.]+$/, ""));
}

export function normalizeCustomCell(v: Cell | undefined): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isoDate(v);
  if (typeof v === "number") return String(Number(v.toPrecision(12)));
  if (typeof v === "boolean") return v ? "是" : "否";
  return v.trim();
}

export function parseCustomImportOptions(value: unknown): CustomImportOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "导入选项格式不正确");
  const options = value as CustomImportOptions;
  if (options.sheet !== undefined && typeof options.sheet !== "string") throw new HttpError(400, "工作表名称无效");
  for (const key of ["header_row", "title_col"] as const) {
    const index = options[key];
    if (index !== undefined && (!Number.isSafeInteger(index) || index < 0)) throw new HttpError(400, "表头行或标题列无效");
  }
  if (options.columns !== undefined) {
    if (!Array.isArray(options.columns) || options.columns.some((column) => !column ||
      !Number.isSafeInteger(column.index) || column.index < 0 || typeof column.name !== "string" || typeof column.keep !== "boolean")) {
      throw new HttpError(400, "列配置格式不正确");
    }
    if (new Set(options.columns.map((column) => column.index)).size !== options.columns.length) throw new HttpError(400, "列配置不能重复");
  }
  return options;
}

function detectHeaderRow(rows: string[][]): number {
  const width = rows.reduce((max, row) => Math.max(max, row.filter(Boolean).length), 0);
  if (width <= 1) return Math.max(0, rows.findIndex((row) => row.some(Boolean)));
  const index = rows.slice(0, 10).findIndex((row) => {
    const cells = row.filter(Boolean);
    return cells.length >= 2 && cells.length >= width * 0.6 && cells.every((cell) =>
      !Number.isFinite(Number(cell.replace(/,/g, ""))) && !parseLooseDate(cell));
  });
  return index < 0 ? 0 : index;
}

export function prepareCustomImport(sheets: CustomSheet[], options: CustomImportOptions = {}): CustomImport {
  parseCustomImportOptions(options);
  const sheet = options.sheet === undefined ? sheets[0] : sheets.find((entry) => entry.name === options.sheet);
  if (!sheet) throw new HttpError(400, "未找到所选工作表");
  const normalized = sheet.rows.map((row) => Array.from(row, normalizeCustomCell));
  const headerRow = options.header_row ?? detectHeaderRow(normalized);
  if (options.header_row !== undefined && headerRow >= normalized.length) throw new HttpError(400, "表头行超出工作表范围");
  const rawHeader = normalized[headerRow] ?? [];
  const dataRows = normalized.slice(headerRow + 1);
  const width = normalized.reduce((max, row) => Math.max(max, row.length), 0);
  if (options.columns?.some((column) => column.index >= width)) throw new HttpError(400, "列配置超出工作表范围");
  const overrides = new Map(options.columns?.map((column) => [column.index, column]));
  const names = new Set<string>();
  const columns: CustomImportPreview["columns"] = [];
  for (let index = 0; index < width; index++) {
    if (!dataRows.some((row) => row[index]) || overrides.get(index)?.keep === false) continue;
    const base = (overrides.get(index)?.name ?? rawHeader[index] ?? "").trim() || `列${index + 1}`;
    let name = base;
    let suffix = 2;
    while (names.has(name)) name = `${base}_${suffix++}`;
    names.add(name);
    columns.push({ index, name });
  }
  let titleCol = options.title_col;
  if (titleCol !== undefined && !columns.some((column) => column.index === titleCol)) throw new HttpError(400, "标题列必须是保留且有数据的列");
  if (titleCol === undefined) {
    for (const pattern of [/名称/, /品名/, /样品/, /样本/, /细胞/, /name/i, /title/i, /编号/, /code/i]) {
      titleCol = columns.find((column) => pattern.test(column.name))?.index;
      if (titleCol !== undefined) break;
    }
    titleCol ??= columns[0]?.index ?? -1;
  }
  const rows = dataRows.map((row) => columns.map((column) => row[column.index] ?? "")).filter((row) => row.some(Boolean));
  const titleIndex = columns.findIndex((column) => column.index === titleCol);
  const order = columns.map((_, index) => index).filter((index) => index !== titleIndex);
  if (titleIndex >= 0) order.unshift(titleIndex);
  return {
    preview: { sheets: sheets.map((entry) => entry.name), sheet: sheet.name, header_row: headerRow, title_col: titleCol,
      columns, rows_preview: rows.slice(0, 10), total_rows: rows.length },
    headers: order.map((index) => columns[index].name),
    rows: rows.map((row) => order.map((index) => row[index])),
  };
}

export async function parseAndSaveCustomCsv(
  client: PoolClient,
  user: SessionUser,
  batchName: string,
  csvText: string
): Promise<CustomBatch> {
  return saveCustomImport(client, user, batchName, prepareCustomImport(customTextSheets(csvText)));
}

export async function saveCustomImport(
  client: PoolClient,
  user: SessionUser,
  batchName: string,
  parsed: CustomImport
): Promise<CustomBatch> {
  const { headers, rows: dataRows } = parsed;
  if (!headers.length) throw new HttpError(400, "请至少保留一列有效数据");
  if (!dataRows.length) throw new HttpError(400, "表格不包含任何有效数据行");
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
    const rowObj = Object.fromEntries(headers.map((header, colIdx) => [header, r[colIdx]]));
    const title = r[0] || `样本-${idx + 1}`;
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

export async function deleteCustomBatch(db: MaterialQuery, batchId: number, user: SessionUser): Promise<boolean> {
  const where = user.role === "admin" ? "id = $1" : "id = $1 AND user_id = $2";
  const params = user.role === "admin" ? [batchId] : [batchId, user.id];
  const [batch] = await db<{ id: number }>(`SELECT id FROM label_custom_batches WHERE ${where}`, params);
  if (!batch) throw new HttpError(404, "批次不存在或无权删除");
  await db(`DELETE FROM label_custom_batches WHERE id = $1`, [batchId]);
  return true;
}

export async function updateCustomItemCell(
  db: MaterialQuery,
  itemId: number,
  fieldKey: string,
  newValue: string,
  user: SessionUser
): Promise<{ id: number; title: string; data: Record<string, string> }> {
  const where = user.role === "admin" ? "ci.id = $1" : "ci.id = $1 AND ci.user_id = $2";
  const params = user.role === "admin" ? [itemId] : [itemId, user.id];
  const [item] = await db<{ id: number; batch_id: number; title: string; data: Record<string, string> }>(
    `SELECT ci.id, ci.batch_id, ci.title, ci.data
       FROM label_custom_items ci
      WHERE ${where}`,
    params
  );
  if (!item) throw new HttpError(404, "记录不存在或无权修改");
  const [batch] = await db<{ headers: string[] }>(
    `SELECT headers FROM label_custom_batches WHERE id = $1`,
    [item.batch_id]
  );
  const headers = Array.isArray(batch?.headers) ? batch.headers : [];
  const data = { ...(item.data || {}), [fieldKey]: newValue };
  let title = item.title;
  if (headers[0] && fieldKey === headers[0]) {
    title = newValue.trim() || item.title;
  }
  await db(
    `UPDATE label_custom_items
        SET data = $1, title = $2
      WHERE id = $3`,
    [JSON.stringify(data), title, itemId]
  );
  return { id: itemId, title, data };
}
