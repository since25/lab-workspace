import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { HttpError, handle } from "@/lib/http";
import { activeTask } from "@/lib/queue";
import { ownJob, rError, rFetchRaw } from "@/lib/rengine";

// 下载结果 ZIP（Excel 汇总 + 重命名后的 .ab1）
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/v1/analysis/jobs/[id]/download">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await ownJob(user, id);
  if (activeTask(id)) throw new HttpError(409, "任务还在排队或分析中");
  const res = await rFetchRaw("/api/download/results", {
    method: "POST",
    body: JSON.stringify({ session_id: id }),
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const err = Array.isArray(data.error) ? data.error[0] : data.error;
    rError(res.status, { error: /缓存已失效/.test(String(err)) ? "结果已过期，请重新分析" : err });
  }
  await audit(user.id, "analysis.download", "analysis_job", id, {}, req);
  const name = (res.headers.get("content-disposition") || "").match(/filename=([^;]+)/)?.[1] || "results.zip";
  return new Response(res.body, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"` },
  });
});
