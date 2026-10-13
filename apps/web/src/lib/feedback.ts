import type { SessionUser } from "./auth";
import { query } from "./db";
import { HttpError, str } from "./http";

export const TITLE_MAX = 100;
export const BODY_MAX = 5000;

// 可见范围：管理员看全部，其他人只看自己发起的。$1 固定为当前用户 id。
// 管理员分支也引用 $1，避免参数类型无法推断
export const visibleSql = (user: SessionUser) => (user.role === "admin" ? "$1::int IS NOT NULL" : "t.author_id = $1");

// 未读：有别人发的、晚于自己上次查看时间的帖子。$1 固定为当前用户 id。
export const UNREAD_SQL = `EXISTS (
  SELECT 1 FROM feedback_posts p
   WHERE p.thread_id = t.id AND p.author_id IS DISTINCT FROM $1
     AND p.created_at > coalesce((SELECT r.read_at FROM feedback_reads r WHERE r.user_id = $1 AND r.thread_id = t.id), '-infinity'))`;

export async function unreadCount(user: SessionUser): Promise<number> {
  const [r] = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM feedback_threads t WHERE ${visibleSql(user)} AND ${UNREAD_SQL}`,
    [user.id]
  );
  return r.n;
}

// 取一条自己能看的留言；看不到按不存在处理
export async function visibleThread(user: SessionUser, id: number) {
  const [t] = await query<{ id: number; author_id: number; title: string; status: string }>(
    `SELECT t.id, t.author_id, t.title, t.status FROM feedback_threads t WHERE t.id = $2 AND ${visibleSql(user)}`,
    [user.id, id]
  );
  if (!t) throw new HttpError(404, "留言不存在");
  return t;
}

export function parseBody(v: unknown): string {
  const body = str(v);
  if (!body) throw new HttpError(400, "内容不能为空");
  if (body.length > BODY_MAX) throw new HttpError(400, `内容不能超过 ${BODY_MAX} 字`);
  return body;
}

export function parseTitle(v: unknown): string {
  const title = str(v);
  if (!title) throw new HttpError(400, "标题不能为空");
  if (title.length > TITLE_MAX) throw new HttpError(400, `标题不能超过 ${TITLE_MAX} 字`);
  return title;
}

export async function markRead(userId: number, threadId: number) {
  await query(
    `INSERT INTO feedback_reads(user_id, thread_id, read_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id, thread_id) DO UPDATE SET read_at = now()`,
    [userId, threadId]
  );
}
