-- 标签模板分别保存名称与字段的水平对齐；现有模板默认左对齐。
ALTER TABLE label_templates
  ADD COLUMN name_align text NOT NULL DEFAULT 'left' CHECK (name_align IN ('left', 'center', 'right')),
  ADD COLUMN detail_align text NOT NULL DEFAULT 'left' CHECK (detail_align IN ('left', 'center', 'right'));
