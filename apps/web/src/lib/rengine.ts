import { query } from "./db";
import { HttpError } from "./http";
import type { SessionUser } from "./auth";

const BASE = process.env.R_ENGINE_URL || "http://127.0.0.1:8001";
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || "200");

// plumber 会把标量包成单元素数组，这里拆回来（只拆顶层）
function unbox(v: unknown): unknown {
  return Array.isArray(v) && v.length === 1 && (typeof v[0] !== "object" || v[0] === null) ? v[0] : v;
}

export async function rCall(path: string, init: RequestInit): Promise<{ status: number; data: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, cache: "no-store" });
  } catch {
    throw new HttpError(503, "分析服务暂时不可用，请稍后再试或联系管理员");
  }
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const data = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, unbox(v)]));
  return { status: res.status, data };
}

export function rFetchRaw(path: string, init: RequestInit) {
  return fetch(BASE + path, { ...init, cache: "no-store" }).catch(() => {
    throw new HttpError(503, "分析服务暂时不可用，请稍后再试或联系管理员");
  });
}

// 任务归属校验：只有创建者能继续上传、分析、下载
export async function ownJob(user: SessionUser, jobId: string, kind?: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(jobId)) throw new HttpError(400, "任务编号不正确");
  const [job] = await query<{ id: string; kind: string; status: string }>(
    "SELECT id, kind, status FROM analysis_jobs WHERE id = $1 AND user_id = $2",
    [jobId, user.id]
  );
  if (!job || (kind && job.kind !== kind)) throw new HttpError(404, "任务不存在");
  if (job.status === "deleted") throw new HttpError(410, "任务已清理，请重新上传");
  return job;
}

export async function setJobStatus(jobId: string, status: string, error = "") {
  await query("UPDATE analysis_jobs SET status = $2, error_summary = $3, updated_at = now() WHERE id = $1", [jobId, status, error.slice(0, 500)]);
}

export async function readBody(req: Request, maxMb = MAX_UPLOAD_MB): Promise<ArrayBuffer> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > maxMb * 1024 * 1024) throw new HttpError(413, `文件不能超过 ${maxMb} MB`);
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(400, "没有收到文件内容");
  if (buf.byteLength > maxMb * 1024 * 1024) throw new HttpError(413, `文件不能超过 ${maxMb} MB`);
  return buf;
}

// R 返回的错误统一转换：会话过期 → 410
export function rError(status: number, data: Record<string, unknown>): never {
  const msg = String(data.error ?? "分析服务出错");
  if (status === 404 || /不存在或已过期|未找到上传会话/.test(msg)) throw new HttpError(410, "任务已过期或已清理，请重新上传");
  throw new HttpError(status >= 400 && status < 600 ? status : 500, msg);
}
