-- 008_freezer_racks.sql：带架子的冰箱（-80℃）可视化布局、架子分配、公共框
-- 只新增表和可空/带默认值的字段，不改动已有数据；未设置布局的冰箱照旧用列表方式。

-- 冰箱布局：总层数、每层可放几个架子。两项都填写时显示可视化布局
ALTER TABLE freezers
  ADD COLUMN shelf_count     integer CHECK (shelf_count BETWEEN 1 AND 20),
  ADD COLUMN racks_per_shelf integer CHECK (racks_per_shelf BETWEEN 1 AND 20);

-- 架子：放在冰箱某层的某个位置，由管理员分配给一个人（未分配时谁都不能往里放盒子）
-- 架子内为 tiers 层 × 每层 depth 个盒位
CREATE TABLE freezer_racks (
  id          serial PRIMARY KEY,
  freezer_id  integer NOT NULL REFERENCES freezers(id),
  shelf_no    integer NOT NULL CHECK (shelf_no >= 1),
  position    integer NOT NULL CHECK (position >= 1),
  owner_id    integer REFERENCES users(id) ON DELETE SET NULL,
  tiers       integer NOT NULL DEFAULT 5 CHECK (tiers BETWEEN 1 AND 20),
  depth       integer NOT NULL DEFAULT 4 CHECK (depth BETWEEN 1 AND 20),
  remarks     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (freezer_id, shelf_no, position)
);

-- 盒子在架子里的格位：架号沿用 rack_no（= 架子的 position），再加架内第几层、该层第几个盒位
-- is_shared：公共框/盒，所有人都能查看和往里存入，每管样品仍只有存放人能操作（仅管理员可设置）
ALTER TABLE freezer_containers
  ADD COLUMN tier_no   integer CHECK (tier_no >= 1),
  ADD COLUMN depth_no  integer CHECK (depth_no >= 1),
  ADD COLUMN is_shared boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT freezer_containers_rack_cell_chk
    CHECK ((tier_no IS NULL) = (depth_no IS NULL) AND (tier_no IS NULL OR (rack_no IS NOT NULL AND kind = 'box')));

-- 一个盒位只能放一个盒子
CREATE UNIQUE INDEX freezer_containers_rack_cell_uniq
  ON freezer_containers(freezer_id, shelf_no, rack_no, tier_no, depth_no) WHERE tier_no IS NOT NULL;
