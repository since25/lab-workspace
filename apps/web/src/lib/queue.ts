// 分析任务排队：全站共用一个先进先出队列，同一时间只运行一个任务。
// 原因：分析服务（R plumber）是单进程，同时发起的请求本来就会串行执行；在网页层显式排队，
// 才能告诉用户前面有几个任务、大约要等多久。队列在网页服务内存中，服务重启后排队中的任务会丢失，
// 页面会提示重新提交。
export type Kind = "sanger" | "nanopore";
export type TaskStatus = "queued" | "running" | "done" | "failed";

interface Task {
  id: string;
  kind: Kind;
  userId: number;
  units: number;
  status: TaskStatus;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  result?: unknown;
  error?: string;
  errors?: unknown;
  run: () => Promise<{ ok: boolean; result?: unknown; error?: string; errors?: unknown }>;
}

interface QueueState {
  tasks: Map<string, Task>;
  order: string[];
  running: string | null;
  // 每个文件/样本的平均耗时（秒），按实际完成情况滑动更新；固定开销另计
  perUnit: Record<Kind, number>;
}

const OVERHEAD: Record<Kind, number> = { sanger: 1, nanopore: 1 };
const KEEP_MS = 60 * 60 * 1000;

const g = globalThis as unknown as { __labQueue?: QueueState };
const q: QueueState = (g.__labQueue ??= { tasks: new Map(), order: [], running: null, perUnit: { sanger: 1.5, nanopore: 0.5 } });

export function estimateSeconds(kind: Kind, units: number): number {
  return OVERHEAD[kind] + q.perUnit[kind] * Math.max(units, 1);
}

export function activeTask(id: string): Task | undefined {
  const t = q.tasks.get(id);
  return t && (t.status === "queued" || t.status === "running") ? t : undefined;
}

export function enqueue(t: Omit<Task, "status" | "enqueuedAt">): void {
  prune();
  q.tasks.set(t.id, { ...t, status: "queued", enqueuedAt: Date.now() });
  q.order.push(t.id);
  void pump();
}

// 取消排队中的任务（运行中的不能取消）
export function cancel(id: string): boolean {
  const t = q.tasks.get(id);
  if (!t || t.status !== "queued") return false;
  q.order = q.order.filter((x) => x !== id);
  q.tasks.delete(id);
  return true;
}

async function pump() {
  if (q.running) return;
  const id = q.order.shift();
  if (!id) return;
  const t = q.tasks.get(id);
  if (!t) return void pump();
  q.running = id;
  t.status = "running";
  t.startedAt = Date.now();
  try {
    const r = await t.run();
    t.status = r.ok ? "done" : "failed";
    t.result = r.result;
    t.error = r.error;
    t.errors = r.errors;
    if (r.ok) {
      const secs = (Date.now() - t.startedAt) / 1000;
      const per = Math.max(0.05, (secs - OVERHEAD[t.kind]) / Math.max(t.units, 1));
      q.perUnit[t.kind] = q.perUnit[t.kind] * 0.7 + per * 0.3;
    }
  } catch (e) {
    t.status = "failed";
    t.error = e instanceof Error ? e.message : String(e);
  } finally {
    t.finishedAt = Date.now();
    q.running = null;
    void pump();
  }
}

function prune() {
  const now = Date.now();
  for (const [id, t] of q.tasks) if (t.finishedAt && now - t.finishedAt > KEEP_MS) q.tasks.delete(id);
}

export interface QueueView {
  status: TaskStatus | "unknown";
  position: number; // 前面还有几个任务（含正在运行的）
  wait_seconds: number; // 预计开始前还要等多久
  elapsed_seconds: number;
  estimate_seconds: number; // 本任务预计运行时长
  remaining_seconds: number; // 本任务预计剩余（含排队）
  queue_length: number; // 全站排队+运行中的任务数
  result?: unknown;
  error?: string;
  errors?: unknown;
}

export function view(id: string): QueueView {
  const t = q.tasks.get(id);
  const queueLength = q.order.length + (q.running ? 1 : 0);
  if (!t) return { status: "unknown", position: 0, wait_seconds: 0, elapsed_seconds: 0, estimate_seconds: 0, remaining_seconds: 0, queue_length: queueLength };
  const now = Date.now();
  const est = estimateSeconds(t.kind, t.units);
  const runningLeft = () => {
    const r = q.running ? q.tasks.get(q.running) : undefined;
    if (!r || !r.startedAt) return 0;
    return Math.max(1, estimateSeconds(r.kind, r.units) - (now - r.startedAt) / 1000);
  };
  if (t.status === "queued") {
    const idx = q.order.indexOf(id);
    const ahead = q.order.slice(0, idx).map((x) => q.tasks.get(x)!).filter(Boolean);
    const wait = runningLeft() + ahead.reduce((s, a) => s + estimateSeconds(a.kind, a.units), 0);
    return {
      status: "queued", position: idx + (q.running ? 1 : 0), wait_seconds: Math.round(wait), elapsed_seconds: 0,
      estimate_seconds: Math.round(est), remaining_seconds: Math.round(wait + est), queue_length: queueLength,
    };
  }
  const elapsed = ((t.finishedAt ?? now) - (t.startedAt ?? now)) / 1000;
  return {
    status: t.status, position: 0, wait_seconds: 0, elapsed_seconds: Math.round(elapsed), estimate_seconds: Math.round(est),
    remaining_seconds: t.status === "running" ? Math.max(1, Math.round(est - elapsed)) : 0, queue_length: queueLength,
    result: t.status === "done" ? t.result : undefined, error: t.error, errors: t.errors,
  };
}
