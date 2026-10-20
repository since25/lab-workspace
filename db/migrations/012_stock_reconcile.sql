-- 库存校对请求：成员或 agent 提交，管理员批准后才同时修改库存和采购记录。
-- 与「已用完申请」分开：一条请求可同时包含一个库存条目和若干采购记录。
CREATE TABLE stock_reconcile_requests (
  id                serial PRIMARY KEY,
  stock_id          integer REFERENCES consumable_stock(id) ON DELETE SET NULL,
  stock_label       text NOT NULL DEFAULT '',
  stock_before      numeric(12,2),
  stock_revision    integer,
  proposed_quantity numeric(12,2) CHECK (proposed_quantity IS NULL OR proposed_quantity >= 0),
  material_ids      integer[] NOT NULL DEFAULT '{}',
  note              text NOT NULL DEFAULT '',
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by      integer REFERENCES users(id) ON DELETE SET NULL,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_by       integer REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  review_note       text NOT NULL DEFAULT ''
);

CREATE INDEX stock_reconcile_status_idx ON stock_reconcile_requests(status, requested_at);
-- 同一耗材同时只允许一条待审批请求，避免两个互相覆盖的数量提议。
CREATE UNIQUE INDEX stock_reconcile_pending_stock_idx
  ON stock_reconcile_requests(stock_id) WHERE status = 'pending' AND stock_id IS NOT NULL;
