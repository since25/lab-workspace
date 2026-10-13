import { NextResponse } from "next/server";

// 业务错误：带 HTTP 状态码，路由统一转成 JSON
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

// 包装路由处理函数：HttpError 按状态码返回，其余错误记日志后返回 500
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      console.error(e);
      return fail(500, "服务器内部错误");
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "请求格式不正确");
  }
}

export function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}
