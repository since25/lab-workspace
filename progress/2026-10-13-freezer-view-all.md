# 2026-10-13 冰箱管理：拆分「超级管理员」与「冰箱只读总览」两种角色

## What was done

- 原设计中「全部人员（只读）」视图只给管理员。按用户要求拆成两种角色：
  - 管理员（超级管理员）：权限不变，含管理冰箱清单、账号管理、操作记录，并可只读查看全部冰箱内容。
  - 普通成员 +「冰箱总览」附加权限：可只读查看全部人员的冰箱内容（含流转记录、按存放人筛选），也能正常存取自己的样品；没有账号管理、操作记录、冰箱清单维护等任何管理权限。
- 数据库迁移 `005_freezer_view_all.sql`：`users` 增加 `freezer_view_all`（默认 false，现有账号权限不变）。
- 登录会话读取该开关，每次请求从数据库读取，开关在账号管理里切换后即时生效。
- 账号管理：创建普通成员时可勾选「冰箱总览」；列表显示标记，可一键开启/取消（管理员行不显示）；变更写入操作记录。
- 新增 `GET /api/v1/freezer/owners` 作为全部人员视图的存放人筛选项（原先借用管理员专用的账号列表接口，只读成员无法访问）。
- 冰箱页面：「全部人员（只读）」切换对管理员和总览成员显示；「管理冰箱」按钮仅管理员显示；提示文字改为「只读视图」。
- 文档：数据模型、接口、决策、架构权限。

## Testing

- 单元测试 24/24 通过；类型检查通过；lint 0 错误；生产构建通过。
- 本机端到端（全新临时库）：上一轮 58 项接口用例全部通过；新增 26 项权限用例全部通过（总览成员可看全部/流转记录/存放人筛选，不能改删他人数据、不能维护冰箱、不能访问账号管理与操作记录接口和页面，可存取自己的样品；普通成员无权限；开关开启/取消即时生效；管理员不受影响；权限变更写入操作记录）。
- 无头浏览器 29 项全部通过（含总览账号页面：有全部人员切换、无管理冰箱按钮、只读视图无勾选与存入、存放人筛选；账号管理开关与标记）；无前端报错。
- 生产部署（windows-wg）：升级前备份 `lab_workspace_20261013_1520.dump`；安装 `LastTaskResult=0`，迁移 005 已执行；健康检查正常；新接口未登录 401；现有 1 个管理员、8 个成员均未开启该权限；细胞 107 条、物料 615 条不变。
- 未验证：生产上用真实账号登录操作。

## Notes

- Changed files：新增 `db/migrations/005_freezer_view_all.sql`、`apps/web/src/app/api/v1/freezer/owners/route.ts`；修改 `apps/web/src/lib/auth.ts`、`apps/web/src/lib/freezer-server.ts`、`apps/web/src/app/api/v1/freezer/samples/[id]/history/route.ts`、`apps/web/src/app/api/v1/admin/users/route.ts`、`apps/web/src/app/api/v1/admin/users/[id]/route.ts`、`apps/web/src/app/(app)/admin/users/page.tsx`、`apps/web/src/app/(app)/freezer/{page.tsx,FreezerClient.tsx}`、`docs/{data-model,api-contract,decisions,architecture}.md`；另在 `../myserver/windows-wg.md` 追加维护记录。
- 未做 Git 提交。
- Rollback：生产侧用 `C:\lab-workspace\incoming\app.prev-freezer-v1.zip` 覆盖 `app.zip` 后重新执行 install.ps1（新增列不影响旧版运行）；需撤回数据结构时 `ALTER TABLE users DROP COLUMN freezer_view_all` 并从 `schema_migrations` 删除 `005_freezer_view_all.sql`。仓库侧还原上述文件。
