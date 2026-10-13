-- 001_init.sql：Lab Workspace V1 初始结构
-- 不含任何真实数据；管理员账号由 scripts/create-admin.mjs 创建

CREATE TABLE users (
  id              serial PRIMARY KEY,
  username        text NOT NULL UNIQUE,
  display_name    text NOT NULL,
  password_hash   text NOT NULL,
  role            text NOT NULL CHECK (role IN ('admin', 'member')),
  is_active       boolean NOT NULL DEFAULT true,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 会话：只存令牌的 SHA-256，Cookie 中才是原始令牌
CREATE TABLE sessions (
  id          text PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE guides (
  id              serial PRIMARY KEY,
  owner_id        integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  target          text NOT NULL DEFAULT '',
  sequence        text NOT NULL,
  pam             text NOT NULL DEFAULT '',
  strand          text NOT NULL DEFAULT '' CHECK (strand IN ('', '+', '-')),
  target_position integer,
  target_base     text NOT NULL DEFAULT '',
  edited_base     text NOT NULL DEFAULT '',
  notes           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE TABLE import_batches (
  id              serial PRIMARY KEY,
  dataset_type    text NOT NULL CHECK (dataset_type IN ('cells', 'materials')),
  filename        text NOT NULL,
  row_count       integer NOT NULL DEFAULT 0,
  accepted_count  integer NOT NULL DEFAULT 0,
  rejected_count  integer NOT NULL DEFAULT 0,
  review_count    integer NOT NULL DEFAULT 0,
  status          text NOT NULL,
  error_summary   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cell_inventory (
  id               serial PRIMARY KEY,
  rack_no          integer NOT NULL CHECK (rack_no >= 1),
  layer_no         integer NOT NULL CHECK (layer_no BETWEEN 1 AND 10),
  cell_name        text NOT NULL,
  source           text NOT NULL DEFAULT '',
  passage          text NOT NULL DEFAULT '',
  density          text NOT NULL DEFAULT '',
  freezing_medium  text NOT NULL DEFAULT '',
  tube_count       integer CHECK (tube_count >= 0),
  tube_count_raw   text NOT NULL DEFAULT '',
  depositor        text NOT NULL DEFAULT '',
  frozen_on        date,
  frozen_on_raw    text NOT NULL DEFAULT '',
  needs_review     boolean NOT NULL DEFAULT false,
  review_reason    text NOT NULL DEFAULT '',
  remarks          text NOT NULL DEFAULT '',
  import_batch_id  integer REFERENCES import_batches(id) ON DELETE SET NULL,
  created_by       integer REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cell_inventory_pos_idx ON cell_inventory(rack_no, layer_no);

CREATE TABLE material_items (
  id                serial PRIMARY KEY,
  requested_on      date,
  requester         text NOT NULL DEFAULT '',
  department        text NOT NULL DEFAULT '',
  request_no        text NOT NULL DEFAULT '',
  material_code     text NOT NULL,
  status            text NOT NULL DEFAULT '',
  major_category    text NOT NULL DEFAULT '',
  minor_category    text NOT NULL DEFAULT '',
  item_name         text NOT NULL DEFAULT '',
  brand             text NOT NULL DEFAULT '',
  spec_model        text NOT NULL DEFAULT '',
  unit              text NOT NULL DEFAULT '',
  quantity          numeric,
  is_urgent         boolean NOT NULL DEFAULT false,
  project_code      text NOT NULL DEFAULT '',
  remarks           text NOT NULL DEFAULT '',
  order_no          text NOT NULL DEFAULT '',
  purchased_qty     numeric,
  last_received_on  date,
  received_qty      numeric,
  receipt_status    text NOT NULL DEFAULT '',
  import_batch_id   integer REFERENCES import_batches(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX material_items_requested_idx ON material_items(requested_on DESC);

-- 分析任务：只记归属和状态，不存序列、文件或结果
CREATE TABLE analysis_jobs (
  id            text PRIMARY KEY,
  user_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('sanger', 'nanopore')),
  status        text NOT NULL DEFAULT 'uploaded',
  error_summary text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id             bigserial PRIMARY KEY,
  actor_id       integer REFERENCES users(id) ON DELETE SET NULL,
  action         text NOT NULL,
  resource_type  text NOT NULL DEFAULT '',
  resource_id    text NOT NULL DEFAULT '',
  metadata_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash        text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_resource_idx ON audit_logs(resource_type, resource_id);
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at DESC);
