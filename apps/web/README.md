# 网页与 API（Next.js）

登录、细胞冻存、部门物料、Guide 库、分析任务编排与下载、账号管理和操作记录。

- 页面：`src/app/(app)/`；接口：`src/app/api/v1/`；业务逻辑：`src/lib/`。
- 表格导入解析：`src/lib/imports/`（xlsx 用 exceljs；WPS 生成的文件 SheetJS 会错位读取文本，已弃用）。
- 环境变量：`DATABASE_URL`、`R_ENGINE_URL`、`TEMP_JOB_TTL_HOURS`、`MAX_UPLOAD_MB`、`COOKIE_SECURE`、`SESSION_SECRET`。
- 脚本：`scripts/migrate.mjs`（执行 `db/migrations`）、`scripts/create-admin.mjs`（创建或重置管理员）。
- 测试：`npx vitest run`。
- 部署见 `docs/deployment.md`。
