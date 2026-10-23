-- 标签打印可见性改为账号级开关（与「冰箱总览」同一模型），不再用租户门禁。
-- 租户表保留作预留，不再参与登录校验或功能授权；因此 users.tenant_id 允许为空，
-- 打印任务也不再要求租户，避免关租户把所有人挡在登录之外。
ALTER TABLE users ADD COLUMN label_print_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE label_print_jobs ALTER COLUMN tenant_id DROP NOT NULL;
