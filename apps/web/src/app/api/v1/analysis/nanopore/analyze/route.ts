import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { HttpError, handle, ok, readJson, str } from "@/lib/http";
import { activeTask, enqueue, view } from "@/lib/queue";
import { ownJob, rCall, setJobStatus } from "@/lib/rengine";
import { analysisStats } from "@/lib/stats";

// 纳米孔分析：rows = [{ file: 样本目录号, guide, target_position, target_base, edited_base }]
// 与 Sanger 共用全站队列
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await readJson(req);
  const job = str(body.job);
  await ownJob(user, job, "nanopore");
  if (activeTask(job)) throw new HttpError(409, "这个任务已在排队或分析中");
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) throw new HttpError(400, "请至少选择一个样本");
  const payload = JSON.stringify({ session_id: job, rows, template_name: str(body.template_name) || "nanopore" });
  await setJobStatus(job, "queued");
  enqueue({
    id: job,
    kind: "nanopore",
    userId: user.id,
    units: rows.length,
    run: async () => {
      await setJobStatus(job, "running");
      const { status, data } = await rCall("/api/nanopore/analyze", { method: "POST", body: payload, headers: { "Content-Type": "application/json" } });
      if (status >= 400 || data.success === false) {
        await setJobStatus(job, "failed", String(data.error ?? ""));
        return { ok: false, error: String(data.error ?? "分析失败"), errors: data.errors };
      }
      const result = data.data as Record<string, unknown>;
      await setJobStatus(job, "analyzed");
      await audit(user.id, "analysis.run", "analysis_job", job, { kind: "nanopore", n_files: result.n_files, n_success: result.n_success }, req);
      // 页面据此弹出「恭喜完成」提示：本次成功样品数 + 我累计的纳米孔样品数
      const celebrate = { n: Number([result.n_success].flat()[0]) || 0, mine: (await analysisStats(user.id)).nanopore };
      return { ok: true, result: { ...result, celebrate } };
    },
  });
  return ok({ job, ...view(job) }, 202);
});
