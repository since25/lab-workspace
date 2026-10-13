import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { HttpError, handle, ok } from "@/lib/http";
import { activeTask, cancel, view } from "@/lib/queue";
import { ownJob, rCall, setJobStatus } from "@/lib/rengine";

// 查询任务排队/分析状态；完成后带回结果
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/v1/analysis/jobs/[id]">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const job = await ownJob(user, id);
  const v = view(id);
  // 网页服务重启后内存队列丢失：数据库里还是排队/运行状态的任务提示重新提交
  if (v.status === "unknown" && (job.status === "queued" || job.status === "running")) {
    return ok({ ...v, status: "lost", error: "服务重启，排队中的任务已中断，请重新点击「开始分析」" });
  }
  return ok(v);
});

// 立即清理任务的临时文件；排队中的任务会先移出队列，运行中的任务不能清理
export const DELETE = handle(async (req: Request, ctx: RouteContext<"/api/v1/analysis/jobs/[id]">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await ownJob(user, id);
  const t = activeTask(id);
  if (t?.status === "running") throw new HttpError(409, "任务正在分析，完成后再清理");
  if (t) cancel(id);
  await rCall(`/api/session?session_id=${encodeURIComponent(id)}`, { method: "DELETE" });
  await setJobStatus(id, "deleted");
  await audit(user.id, "analysis.delete", "analysis_job", id, {}, req);
  return ok({ ok: true });
});
