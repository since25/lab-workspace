import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { HttpError, handle, ok, readJson, str } from "@/lib/http";
import { activeTask, enqueue, view } from "@/lib/queue";
import { ownJob, rCall, setJobStatus } from "@/lib/rengine";

// Sanger 单序列分析：整批共用一条 guide。提交后进入全站队列，立即返回排队状态，
// 页面再通过 GET /analysis/jobs/:id 轮询进度与结果。
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await readJson(req);
  const job = str(body.job);
  await ownJob(user, job, "sanger");
  if (activeTask(job)) throw new HttpError(409, "这个任务已在排队或分析中");
  const payload = {
    session_id: job,
    sequence: str(body.sequence).toUpperCase().replace(/\s+/g, ""),
    target_position: Number(body.target_position),
    target_base: str(body.target_base).toUpperCase(),
    edited_base: str(body.edited_base).toUpperCase(),
    ref_sequence: str(body.ref_sequence).toUpperCase().replace(/\s+/g, "") || undefined,
    rename_config: body.rename_config && typeof body.rename_config === "object" ? body.rename_config : {},
    template_name: str(body.template_name) || "sanger",
  };
  if (!payload.sequence) throw new HttpError(400, "请填写 guide 序列");
  if (!/^[ACGT]+$/.test(payload.sequence)) throw new HttpError(400, "guide 序列只能包含 A/C/G/T");
  if (!Number.isInteger(payload.target_position) || payload.target_position < 1 || payload.target_position > payload.sequence.length) {
    throw new HttpError(400, "目标位置必须在 guide 序列范围内");
  }
  if (payload.target_base === payload.edited_base) throw new HttpError(400, "目标碱基和编辑后碱基不能相同");
  const [{ n_units }] = await query<{ n_units: number }>("SELECT n_units FROM analysis_jobs WHERE id = $1", [job]);
  await setJobStatus(job, "queued");
  enqueue({
    id: job,
    kind: "sanger",
    userId: user.id,
    units: n_units,
    run: async () => {
      await setJobStatus(job, "running");
      const { status, data } = await rCall("/api/analyze", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      });
      if (status >= 400 || data.success === false) {
        await setJobStatus(job, "failed", String(data.error ?? ""));
        return { ok: false, error: String(data.error ?? "分析失败"), errors: data.errors };
      }
      const result = data.data as Record<string, unknown>;
      await setJobStatus(job, "analyzed");
      await audit(user.id, "analysis.run", "analysis_job", job, { kind: "sanger", n_files: result.n_files, n_success: result.n_success }, req);
      return { ok: true, result };
    },
  });
  return ok({ job, ...view(job) }, 202);
});
