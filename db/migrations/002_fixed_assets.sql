-- 002_fixed_assets.sql：固定资产台账（只读查询，管理员整表替换导入，仅研发部资产）
ALTER TABLE import_batches DROP CONSTRAINT import_batches_dataset_type_check;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_dataset_type_check
  CHECK (dataset_type IN ('cells', 'materials', 'assets'));

CREATE TABLE fixed_assets (
  id               serial PRIMARY KEY,
  asset_name       text NOT NULL,
  spec_model       text NOT NULL DEFAULT '',
  category         text NOT NULL DEFAULT '',
  quantity         numeric,
  location         text NOT NULL DEFAULT '',
  department       text NOT NULL DEFAULT '',
  user_name        text NOT NULL DEFAULT '',
  import_batch_id  integer REFERENCES import_batches(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fixed_assets_name_idx ON fixed_assets(asset_name);
