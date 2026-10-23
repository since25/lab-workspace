import { HttpError } from "./http";
import type { SessionUser } from "./auth";
import type { MaterialQuery } from "./materials-list";

// 标签打印的公共部分：账号开关、打印机目录、调用本机标签服务。
// 数据来源、字段白名单、模板与分页在 label-sources.ts 里。

export function requireLabelPrinting(user: SessionUser) {
  if (!user.label_print_enabled) throw new HttpError(403, "当前账号未开通标签打印，请联系管理员");
  return user;
}

export type Printer = { id: number; printer_key: string; name: string; enabled: boolean; is_default: boolean; ready?: boolean; reason?: string; jobs?: number; notes?: string };

export async function listPrinters(db: MaterialQuery, includeDisabled = false) {
  const rows = await db<Printer>(`SELECT id, printer_key, name, enabled, is_default FROM label_printers ${includeDisabled ? "" : "WHERE enabled"} ORDER BY is_default DESC, name, id`);
  return rows;
}

export async function callLabelPrint(path: string, body?: unknown) {
  const base = (process.env.LABELPRINT_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new HttpError(503, `标签打印服务不可用：${e instanceof Error ? e.message : String(e)}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status === 409 ? 409 : 503, data.error || "标签打印服务返回失败");
  return data as Record<string, unknown>;
}
