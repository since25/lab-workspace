import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { UNREAD_SQL, markRead, parseBody, parseTitle, visibleSql } from "@/lib/feedback";
import { handle, ok, readJson, str } from "@/lib/http";

// 留言列表：管理员看全部，成员只看自己的；status = open（默认）/ closed / all。未读的排在前面。
export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const status = str(new URL(req.url).searchParams.get("status")) || "open";
  const statusSql = status === "all" ? "" : `AND t.status = '${status === "closed" ? "closed" : "open"}'`;
  const threads = await query(
    `SELECT t.id, t.title, t.status, t.created_at, t.last_post_at, u.display_name AS author_name,
            (SELECT count(*)::int - 1 FROM feedback_posts p WHERE p.thread_id = t.id) AS reply_count,
            ${UNREAD_SQL} AS unread
       FROM feedback_threads t JOIN users u ON u.id = t.author_id
      WHERE ${visibleSql(user)} ${statusSql}
      ORDER BY unread DESC, t.last_post_at DESC
      LIMIT 500`,
    [user.id]
  );
  return ok({ threads });
});

// 发起留言：{title, body}
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const b = await readJson(req);
  const title = parseTitle(b.title);
  const body = parseBody(b.body);
  const id = await withTransaction(async (c) => {
    const r = await c.query<{ id: number }>("INSERT INTO feedback_threads(author_id, title) VALUES ($1, $2) RETURNING id", [user.id, title]);
    const tid = r.rows[0].id;
    await c.query("INSERT INTO feedback_posts(thread_id, author_id, body) VALUES ($1, $2, $3)", [tid, user.id, body]);
    // 审计只记标题，不记正文
    await audit(user.id, "feedback.create", "feedback", tid, { title }, req, c);
    return tid;
  });
  await markRead(user.id, id);
  return ok({ id }, 201);
});
