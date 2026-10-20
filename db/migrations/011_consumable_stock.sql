-- 常用耗材库存：与采购记录分表保存，数量只以人工核对为准。
-- 不修改 material_items，采购增量同步不会覆盖这里的状态。
CREATE TABLE consumable_stock (
  id               serial PRIMARY KEY,
  category         text NOT NULL,
  item_name        text NOT NULL,
  brand            text NOT NULL DEFAULT '',
  spec_model       text NOT NULL DEFAULT '',
  unit             text NOT NULL DEFAULT '',
  quantity         numeric(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  safety_stock     numeric(12,2) NOT NULL DEFAULT 0 CHECK (safety_stock >= 0),
  note             text NOT NULL DEFAULT '',
  last_checked_at  timestamptz,
  last_checked_by  integer REFERENCES users(id) ON DELETE SET NULL,
  revision         integer NOT NULL DEFAULT 0,
  created_by       integer REFERENCES users(id) ON DELETE SET NULL,
  updated_by       integer REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consumable_stock_identity UNIQUE (category, item_name, brand, spec_model)
);
CREATE INDEX consumable_stock_category_idx ON consumable_stock(category, item_name);

-- 每次核对都保留改前/改后数量，形成库存台账；不覆盖历史。
CREATE TABLE consumable_stock_checks (
  id          serial PRIMARY KEY,
  stock_id    integer NOT NULL REFERENCES consumable_stock(id) ON DELETE CASCADE,
  before_qty  numeric(12,2) NOT NULL,
  after_qty   numeric(12,2) NOT NULL,
  note        text NOT NULL DEFAULT '',
  checked_by  integer REFERENCES users(id) ON DELETE SET NULL,
  checked_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consumable_stock_checks_stock_idx ON consumable_stock_checks(stock_id, checked_at DESC);
