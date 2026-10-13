import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { HttpError, handle, ok, str } from "@/lib/http";
import { rCall, rError, readBody } from "@/lib/rengine";

// 上传纳米孔厂商交付包（zip），R 侧只解出 Sequences / Bam(*.bam) / Frequency_tables / Suspious_sites
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const filename = str(new URL(req.url).searchParams.get("filename"));
  if (!/\.zip$/i.test(filename)) throw new HttpError(400, "请上传纳米孔交付包 .zip");
  const body = await readBody(req);
  const { status, data } = await rCall("/api/nanopore/upload", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (status >= 400 || data.success === false) rError(status, data);
  const job = String(data.session_id);
  await query("INSERT INTO analysis_jobs(id, user_id, kind, n_units) VALUES ($1, $2, 'nanopore', $3)", [job, user.id, Number(data.n_samples) || 0]);
  await audit(user.id, "analysis.create", "analysis_job", job, { kind: "nanopore", n_samples: data.n_samples }, req);
  // plumber 把每个样本号包成单元素数组，这里拍平成字符串
  const samples = ([] as unknown[]).concat(data.samples ?? []).map((x) => String(Array.isArray(x) ? x[0] : x));
  return ok({ job, samples });
});
