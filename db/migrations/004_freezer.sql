-- 004_freezer.sql：冰箱管理（冰箱 → 容器（盒子/框）→ 样品，样品只定位到容器）
-- 冰箱由管理员维护；容器和样品归创建人，普通用户只能看到自己的，管理员可只读查看全部

CREATE TABLE freezers (
  id           serial PRIMARY KEY,
  name         text NOT NULL UNIQUE,
  temperature  text NOT NULL CHECK (temperature IN ('-80', '-20', '4')),
  location     text NOT NULL DEFAULT '',
  remarks      text NOT NULL DEFAULT '',
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 容器：盒子或框；层号必填，架号、架内格位选填（大箱子/框通常不填）
CREATE TABLE freezer_containers (
  id          serial PRIMARY KEY,
  owner_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  freezer_id  integer NOT NULL REFERENCES freezers(id),
  kind        text NOT NULL CHECK (kind IN ('box', 'basket')),
  name        text NOT NULL,
  shelf_no    integer NOT NULL CHECK (shelf_no >= 1),
  rack_no     integer CHECK (rack_no >= 1),
  slot_no     integer CHECK (slot_no >= 1),
  remarks     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX freezer_containers_owner_idx ON freezer_containers(owner_id);
CREATE INDEX freezer_containers_pos_idx ON freezer_containers(freezer_id, shelf_no, rack_no, slot_no);

-- 样品：一条 = 一管；取出后保留记录（status = removed），流转历史写审计日志
-- 在库样品必须有容器；容器删除后，其中已取出样品的容器置空
CREATE TABLE freezer_samples (
  id            serial PRIMARY KEY,
  owner_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  container_id  integer REFERENCES freezer_containers(id) ON DELETE SET NULL,
  name          text NOT NULL,
  project_no    text NOT NULL DEFAULT '',
  sample_type   text NOT NULL DEFAULT '',
  remarks       text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'stored' CHECK (status IN ('stored', 'removed')),
  stored_on     date NOT NULL DEFAULT current_date,
  removed_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'removed' OR container_id IS NOT NULL)
);
CREATE INDEX freezer_samples_owner_idx ON freezer_samples(owner_id, status);
CREATE INDEX freezer_samples_container_idx ON freezer_samples(container_id);
