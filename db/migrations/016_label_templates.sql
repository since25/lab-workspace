-- TASK-90：标签打印自定义模板。
-- 管理员复制内置模板（name-detail / uniform / name-only）后调整字号、行距、字段顺序与前缀；
-- 模板绑定一个来源（三个来源字段不同）。删除只做隐藏，历史打印记录仍能对上模板。

CREATE TABLE label_templates (
  id             serial PRIMARY KEY,
  source         text NOT NULL CHECK (source IN ('materials', 'freezer', 'assets')),
  name           text NOT NULL,
  base_template  text NOT NULL CHECK (base_template IN ('name-detail', 'uniform', 'name-only')),
  name_pt        integer NOT NULL CHECK (name_pt BETWEEN 12 AND 72),
  detail_pt      integer NOT NULL CHECK (detail_pt BETWEEN 10 AND 48),
  line_gap       integer NOT NULL CHECK (line_gap BETWEEN 0 AND 20),
  -- 有序数组：[{ "key": "item_name", "prefix": "" }, ...]，第一个是大字标题
  fields         jsonb NOT NULL,
  is_deleted     boolean NOT NULL DEFAULT false,
  created_by     integer REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX label_templates_name_idx ON label_templates(source, name) WHERE NOT is_deleted;

-- 打印任务记录用的是哪个自定义模板；内置模板为空，原 template 文本列照旧写「来源:模板」。
ALTER TABLE label_print_jobs ADD COLUMN template_id integer REFERENCES label_templates(id) ON DELETE SET NULL;
