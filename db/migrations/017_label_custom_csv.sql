-- TASK-102：自定义 CSV 标签打印（批次台账固化）
-- 用户上传 CSV 文件固化存储为批次与明细行，用于自定义标签排版与多选打印。
-- 数据按上传用户隔离（普通成员只读写自己的批次，管理员可查看全部）。

CREATE TABLE label_custom_batches (
  id          serial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_name  text NOT NULL,
  headers     jsonb NOT NULL,
  row_count   integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX label_custom_batches_user_idx ON label_custom_batches(user_id, created_at DESC);

CREATE TABLE label_custom_items (
  id          serial PRIMARY KEY,
  batch_id    integer NOT NULL REFERENCES label_custom_batches(id) ON DELETE CASCADE,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  data        jsonb NOT NULL,
  row_idx     integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX label_custom_items_batch_idx ON label_custom_items(batch_id, row_idx ASC);
CREATE INDEX label_custom_items_user_idx ON label_custom_items(user_id);

ALTER TABLE label_templates DROP CONSTRAINT label_templates_source_check;
ALTER TABLE label_templates ADD CONSTRAINT label_templates_source_check CHECK (source IN ('materials', 'freezer', 'assets', 'cells', 'custom'));
