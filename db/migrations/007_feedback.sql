-- 007_feedback.sql：留言板（成员向管理员反馈，类似 issue）
-- 成员只能看到自己发起的留言；管理员看全部、可回复、可标记已解决。不做推送，只在页面上用角标提示未读。

CREATE TABLE feedback_threads (
  id            serial PRIMARY KEY,
  author_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         text NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  last_post_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_threads_author_idx ON feedback_threads(author_id);

-- 留言正文与回复：第一条是发起时的正文
CREATE TABLE feedback_posts (
  id          serial PRIMARY KEY,
  thread_id   integer NOT NULL REFERENCES feedback_threads(id) ON DELETE CASCADE,
  author_id   integer REFERENCES users(id) ON DELETE SET NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_posts_thread_idx ON feedback_posts(thread_id, created_at);

-- 已读标记：某人最后一次查看某条留言的时间；之后别人发的回复算未读
CREATE TABLE feedback_reads (
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id  integer NOT NULL REFERENCES feedback_threads(id) ON DELETE CASCADE,
  read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);
