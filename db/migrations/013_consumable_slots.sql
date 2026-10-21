-- 常用耗材改为「固定规格槽位」：库存数记在槽位（consumable_stock 一行 = 一个槽位），
-- 品牌货号挂在槽位下（consumable_stock_skus），采购记录与槽位的对应单独保存（consumable_stock_links）。
-- 不修改 material_items；只新增列和表，旧条目保持原样，由管理员在部署时决定是否清理。

-- slot_key：内置模板槽位的标识，手工新增的槽位为空；baseline_at：第一次人工核对（基线）的时间。
ALTER TABLE consumable_stock
  ADD COLUMN slot_key    text UNIQUE,
  ADD COLUMN baseline_at timestamptz;
UPDATE consumable_stock s SET baseline_at = (
  SELECT min(c.checked_at) FROM consumable_stock_checks c WHERE c.stock_id = s.id
) WHERE s.last_checked_at IS NOT NULL;

-- 核对历史区分人工盘点（check）和按采购记录确认的入库（inbound），消耗只按盘点差计算。
ALTER TABLE consumable_stock_checks
  ADD COLUMN kind text NOT NULL DEFAULT 'check' CHECK (kind IN ('check', 'inbound'));

-- 货号记忆：同一归一键（名称|品牌|规格）只对应一个槽位；stock_id 为空表示该货号已被排除，不是常用耗材。
CREATE TABLE consumable_stock_skus (
  id           serial PRIMARY KEY,
  identity_key text NOT NULL UNIQUE,
  stock_id     integer REFERENCES consumable_stock(id) ON DELETE CASCADE,
  item_name    text NOT NULL DEFAULT '',
  brand        text NOT NULL DEFAULT '',
  spec_model   text NOT NULL DEFAULT '',
  created_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consumable_stock_skus_stock_idx ON consumable_stock_skus(stock_id);

-- 采购记录 → 槽位：pending 待确认归属，confirmed 已确认（基线后的才会出现在待入库），
-- stocked 已入库加数，skipped 确认后选择不加数，excluded 排除。
CREATE TABLE consumable_stock_links (
  material_id  integer PRIMARY KEY REFERENCES material_items(id) ON DELETE CASCADE,
  stock_id     integer REFERENCES consumable_stock(id) ON DELETE SET NULL,
  identity_key text NOT NULL,
  state        text NOT NULL CHECK (state IN ('pending', 'confirmed', 'stocked', 'skipped', 'excluded')),
  confidence   text NOT NULL DEFAULT 'high' CHECK (confidence IN ('known', 'high', 'mid', 'low')),
  applied_qty  numeric(12,2),
  decided_by   integer REFERENCES users(id) ON DELETE SET NULL,
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consumable_stock_links_state_idx ON consumable_stock_links(state, stock_id);
CREATE INDEX consumable_stock_links_identity_idx ON consumable_stock_links(identity_key);
