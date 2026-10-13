import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { HttpError, handle, ok, str } from "@/lib/http";
import { activeTask } from "@/lib/queue";
import { ownJob, rCall, rError, readBody } from "@/lib/rengine";

// 逐个上传 .ab1（或一个含 .ab1 的 zip）；首个文件创建任务，之后带 job 参数追加到同一任务
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const sp = new URL(req.url).searchParams;
  const filename = str(sp.get("filename"));
  const job = str(sp.get("job"));
  if (!/\.(ab1|zip)$/i.test(filename)) throw new HttpError(400, "只接受 .ab1 文件或包含 .ab1 的 .zip");
  if (job) {
    await ownJob(user, job, "sanger");
    if (activeTask(job)) throw new HttpError(409, "任务正在排队或分析中，不能追加文件");
  }
  const body = await readBody(req);
  const isZip = /\.zip$/i.test(filename);
  const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
  if (job) headers["X-Session-Id"] = job;
  const { status, data } = await rCall(
    isZip ? "/api/upload/zip" : `/api/upload/file?filename=${encodeURIComponent(filename)}`,
    { method: "POST", body, headers }
  );
  if (status >= 400 || data.success === false) rError(status, data);
  const sessionId = String(data.session_id);
  if (!job) {
    await query("INSERT INTO analysis_jobs(id, user_id, kind) VALUES ($1, $2, 'sanger')", [sessionId, user.id]);
    await audit(user.id, "analysis.create", "analysis_job", sessionId, { kind: "sanger" }, req);
  }
  const raw = isZip ? data.extracted_files : data.filename;
  const files = ([] as unknown[]).concat(raw ?? []).map((x) => String(Array.isArray(x) ? x[0] : x));
  await query("UPDATE analysis_jobs SET n_units = n_units + $2, status = 'uploaded', updated_at = now() WHERE id = $1", [sessionId, files.length]);
  return ok({ job: sessionId, files });
});
