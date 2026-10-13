# 数据库迁移

`migrations/` 下按序号命名的 SQL 文件由 `apps/web/scripts/migrate.mjs` 按文件名顺序执行，已执行的记录在 `schema_migrations` 表中。已上线的迁移文件不要修改，结构变更请新增下一个序号的文件。

迁移文件不得包含真实实验室数据、账号、密码或原始导入工作簿。
