# 2026-10-13 V1 开发完成并部署到 windows-wg

## What was done

- 分析服务 `apps/r-engine`：从 EditR_wang（0ca92f0）复制 Sanger / 纳米孔 / 结果打包相关 R 代码，新写精简版 `api.R` 与 `start.R`（只监听本机、临时文件按 24 小时清理、提供立即清理接口）；纳米孔上传改为只解出三类分析文件；注释中 GBK 无法表示的字符替换为普通字符。
- 网页与 API `apps/web`（Next.js 16）：登录（bcrypt、会话存库、失败锁定）、账号管理、操作记录、细胞冻存（导入预览/提交、筛选、取出扣管数、编辑、修改历史、管理员删除、待核对）、部门物料（整表替换导入、搜索筛选分页）、个人 Guide 库（隔离、导出）、Sanger 与纳米孔分析（任务归属校验、结果下载）、浏览器内文件重命名。
- 表格导入：exceljs 读取 xlsx（SheetJS 对 WPS 文件错位读取，已弃用）、自写 CSV 解析；合并单元格值填充；无法识别的管数/日期保留原文并标待核对。
- 数据库：`db/migrations/001_init.sql`，`scripts/migrate.mjs`、`scripts/create-admin.mjs`。
- 部署：`infra/windows/`（安装包生成、离线 R 包仓库、install/run/backup/uninstall 脚本）；在 windows-wg 原生安装，创建管理员 `wangyichuan`，导入细胞 106 条（9 条待核对、4 行未导入）与物料 615 条。
- 文档：新增 `docs/deployment.md`，更新 README、决策、数据模型、接口、架构、计划。

## Testing

- 单元测试：`apps/web` vitest 14/14 通过；`apps/r-engine/tests` 5 个 R 测试全部通过（含新增 `test_nanopore_upload.R`、`test_gbk_safe.R`）。
- 算法一致性：对上游公开示例 RP272，迁移版与原版 EditR 的 summary 完全一致（identical = TRUE）。
- 开发机端到端（临时 PostgreSQL + R + 独立构建网页）：权限、导入、修改历史、Guide 隔离、分析任务隔离、停用与锁定等全部用例通过；页面对管理员/成员/未登录的访问控制正确。
- 生产（windows-wg）：安装第 3 次 `LastTaskResult=0`；健康检查正常；Sanger（含中文文件名）结果与开发机一致；纳米孔合成包分析正常；手动备份成功。
- 未验证：整机重启后的自启；单位内网（10.129.x.x）客户端访问；浏览器内的交互（对话框、导入预览界面）只做了构建与类型检查、未做真实点击测试。

## Notes

- Changed files：`.gitignore`、`README.md`、`apps/r-engine/**`、`apps/web/**`（除 node_modules）、`db/README.md`、`db/migrations/001_init.sql`、`docs/*.md`、`examples/*.csv`、`infra/docker-compose.yml`、`infra/windows/*`；另在 `../myserver/windows-wg.md` 追加维护记录。
- `apps/web.placeholder/README.md` 是原占位说明的残留（删除操作被工具安全检查拦截），可手动删除。
- 安装包输出在 `dist/`（已忽略，不进 Git）。
- Rollback：目标机执行 `C:\lab-workspace\deploy\uninstall.ps1`；仓库侧 `git checkout -- <已跟踪文件>` 并删除上述新增目录。未做任何 Git 提交。
