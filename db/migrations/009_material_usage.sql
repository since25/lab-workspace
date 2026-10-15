-- 每条采购记录保留独立的本地使用状态；迁移不删除或合并既有记录。
-- 组合键若已有重复，唯一约束会使迁移失败并由迁移器回滚，需先人工核对。
ALTER TABLE material_items
  ADD COLUMN is_used_up boolean NOT NULL DEFAULT false,
  ADD COLUMN used_up_at timestamptz,
  ADD COLUMN used_up_by integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN used_up_requested_at timestamptz,
  ADD COLUMN used_up_requested_by integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT material_purchase_unique UNIQUE (request_no, material_code);

CREATE INDEX material_pending_usage_idx ON material_items(used_up_requested_at)
  WHERE NOT is_used_up AND used_up_requested_at IS NOT NULL;
