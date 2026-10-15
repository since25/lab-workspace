# 物料增量同步和 OA 每周任务部署

## What was done

- 用户明确要求“提交，推送部署”后，将已核对的本轮实现提交为 `4a350c3`，推送 `origin/main`，部署到 windows-wg；未纳入既有演示文件、PPT 工作目录和其他未跟踪进度记录。
- 通过既有 `infra/windows/build-bundle.sh` 生成网页部署包，沿用 Windows 安装入口升级应用并执行 `009_material_usage.sql`。安装前备份数据库、旧应用包、部署脚本和受限配置，保存原记录身份摘要用于只读比对。
- 在受限 `lab.env` 配置两个展示部门。服务器使用无外层引号、中文以 Unicode 转义表示的 ASCII JSON，兼容 PowerShell 5.1 逐行读取环境变量；真实值未写入仓库或安装包。
- 独立安装 OA 程序到 `C:\lab-workspace\automation\oa-export`，受限配置为 `C:\lab-workspace\config\oa.env`，下载目录为 `E:\lab-workspace\oa-materials`。每次新建浏览器和上下文，重新用账号密码登录，不保存 OA cookie 或会话。
- 实测该机 Edge 在 SYSTEM 下启动失败，浏览器退出码 1002，失败发生于 OA 登录前且未入库。独立浏览器探针在 SYSTEM 下复现，在现有管理员账号 S4U 下成功；随后按同一 S4U 身份完成两次真实 OA 导出及入库。安装脚本改为安装执行者的现有管理员账号、S4U、最高权限，无需保存 Windows 密码或保持交互登录；OA 凭证仍由独立受限配置提供。
- 已启用 `LabWorkspace-OA-Export`：每周六北京时间 03:00，单次最长 10 分钟、IgnoreNew、无失败重试。验收时下次运行为 2026-10-17 03:00。更新部署、需求、决策和开发状态文档。

## Testing

- 提交前重新执行工作台 50/50、OA 程序 8/8 测试，均通过；当前网页构建通过。前轮隔离验证的 TypeScript、权限及状态保留 SQL 测试、10 项实际 React 组件浏览器交互检查仍对应本次部署代码；证据见同日物料实现日志。
- 新网页包 7,444,601 字节，OA 包 3,672,180 字节；ZIP CRC、env 排除和包内真实配置值扫描通过。上传后 SHA-256 比对通过。网页包 VERSION 为 `4a350c3`。
- 升级前数据库备份为自定义格式、107,414 字节，`pg_restore --list` 成功；迁移执行成功，数据库迁移版本已包含 `009_material_usage.sql`。
- 第一次成功任务：导出 3,016 条，新增 2,401、更新 2、未变化 613。第二次独立新登录任务：新增 0、更新 0、未变化 3,016，数据库无重复新增。两个实际 XLSX 文件均非空，检查了 ZIP 工作簿结构。
- 只读核对数据库共有 3,016 条、20 个部门，按配置展示范围计算为 919 条；原有 615 条的 ID 和采购组合键摘要全部一致。初始已用完及待审批计数均为 0。
- 两次成功计划任务均退出 0；最终状态 Ready、下一次时间正确、S4U / Highest、PT10M / IgnoreNew / RestartCount=0。运行锁及 partial 文件已清理。
- 在线健康检查 HTTP 200，数据库和 R 服务均为 true；未登录访问物料列表、状态操作、管理员审批接口均返回 401。配置和输出目录均关闭权限继承，仅管理员与 SYSTEM 两条访问规则；S4U 最高权限任务可读写。
- 修正后的安装脚本在服务器 PowerShell 5.1 中语法解析通过；实际 S4U 原则与安装表达式一致。此次仅调整部署身份和文档，未改动已验证的网页及导入业务代码。
- 未使用真实用户账号点击生产审批/恢复，不为测试创建生产账号或会话；这些角色行为、二次确认和标记保留由隔离 SQL、路由和组件测试覆盖。未来周六自然触发尚未发生，已核对注册的触发器并完成两次手动触发同一计划任务。

## Notes

- Changed files：`infra/windows/install-oa-export.ps1`、`README.md`、`docs/{decisions,deployment,development-plan,materials-update-plan,oa-material-export}.md`、本日志；业务实现见 `4a350c3`。部署后的网页 VERSION 保持 `4a350c3`，后续提交只包含安装身份修正和运维记录。
- 生成入口：`bash infra/windows/build-bundle.sh` 输入已提交源码和锁定依赖，输出忽略的 `dist/bundle/app.zip`；`bash infra/windows/build-oa-export.sh` 输入 OA 源码和增量入口，输出忽略的 `dist/oa-export.zip`。真实 OA 文件仅保存在受限服务器输出目录，不进入仓库。
- 运行日志：`E:\lab-workspace\logs\oa-export.log`、`E:\lab-workspace\oa-materials\runs.jsonl`；部署日志：`E:\lab-workspace\logs\deploy-oa-20261015.log`。失败的 SYSTEM 启动记录保留，之后两次成功记录可追溯。
- Rollback：数据库备份 `E:\lab-workspace\backups\pre_oa_20261015_172702.dump`；旧应用 `C:\lab-workspace\incoming\app.prev-oa-20261015_172702.zip`；配置 `C:\lab-workspace\config\lab.env.pre-oa-20261015_172702`；原部署脚本 `C:\lab-workspace\deploy.pre-oa-20261015_172702`。如需回滚，先停用 OA 任务并等待当前运行结束，再停网页、按明确确认的恢复时点恢复数据库、应用和配置，最后重启并核对健康状态。不能仅恢复旧网页后继续使用其整表替换导入，否则会丢失新标记。备份时点之后的变更需另外保全，当前未执行回滚。
- 收尾核对：服务器安装脚本 SHA-256 与本地修正版一致；移除本轮一次性部署/浏览器探针任务及临时脚本、本地凭证副本，保留正式 OA 任务、原始 OA 运行记录和所有升级备份。清理后健康检查仍正常，原有 Web/R/备份任务和新增 OA 任务均存在；真实配置值再次扫描未进入本次修改文件，`git diff --check` 通过。
