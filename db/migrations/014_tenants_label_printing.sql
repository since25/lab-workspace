-- TASK-87：租户级标签打印开关与全局打印机目录。
-- 现有业务表保持原有共享口径；本迁移只给账号和打印能力建立租户边界。

CREATE TABLE tenants (
  id                  serial PRIMARY KEY,
  slug                text NOT NULL UNIQUE,
  name                text NOT NULL,
  is_active           boolean NOT NULL DEFAULT true,
  label_print_enabled boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tenants(slug, name, label_print_enabled)
VALUES ('default', '默认租户', true)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE users ADD COLUMN tenant_id integer;
UPDATE users SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default') WHERE tenant_id IS NULL;
ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
CREATE INDEX users_tenant_idx ON users(tenant_id);

CREATE TABLE label_printers (
  id           serial PRIMARY KEY,
  printer_key  text NOT NULL UNIQUE,
  name         text NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO label_printers(printer_key, name, is_default)
VALUES ('brady-bbp12', 'Brady BBP12', true)
ON CONFLICT (printer_key) DO NOTHING;
CREATE INDEX label_printers_enabled_idx ON label_printers(enabled, name);

CREATE TABLE label_print_jobs (
  id           bigserial PRIMARY KEY,
  request_id   text NOT NULL UNIQUE,
  tenant_id    integer NOT NULL REFERENCES tenants(id),
  user_id      integer REFERENCES users(id) ON DELETE SET NULL,
  printer_key  text NOT NULL,
  template     text NOT NULL,
  fields       jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_count    integer NOT NULL,
  status       text NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  result       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX label_print_jobs_tenant_idx ON label_print_jobs(tenant_id, created_at DESC);

