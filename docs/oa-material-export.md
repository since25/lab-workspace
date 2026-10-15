# OA 部门物料自动导出

目标是替代手动登录和点击导出。独立程序每次创建临时浏览器、用账号密码登录 OA，经「采购管理 → 部门物料」进入报表，在两层 iframe 内点击「导出」。不调用 OA API，不保存 cookie、storageState 或固定浏览器用户目录。

已确认每周六运行一次，目标为 windows-wg，服务器时间 03:00（China Standard Time，UTC+8）。程序已支持下载后增量入库，保留全部部门的 21 个业务字段及本地已用完、待审批状态。2026-10-15 已部署并完成真实计划任务导出、入库验收；记录匹配和审批规则见 `materials-update-plan.md`。

## 配置与本地运行

- Node.js 22 或更新版本；依赖固定在 `apps/oa-export/package-lock.json`。
- 服务器使用已经安装的 Microsoft Edge，`OA_BROWSER_CHANNEL=msedge`。本机可使用与 Playwright 匹配的 Chromium；需要指定路径时设置 `OA_BROWSER_EXECUTABLE`，不要同时指定 channel。
- 配置示例：`apps/oa-export/.env.example`，示例仅含虚构地址和账号。真实配置放根目录 `.env` 或服务器 `C:\lab-workspace\config\oa.env`。`.env` 和 `*.env` 均已被 Git 忽略；服务器配置保持在仓库之外。
- 兼容已有根目录配置名 `oa_url_materials`、`user`、`password`。推荐新配置用 `OA_URL`、`OA_USERNAME`、`OA_PASSWORD`。文件采用 dotenv 格式，含 `#` 等字符的值请加引号。相对输出目录以 env 所在目录为基准。
- 页面定位通过 `OA_*_SELECTOR`、`OA_NAVIGATION_STEPS`、`OA_EXPORT_FRAMES` 配置。导航只支持 click/hover，可附 `frames` 数组；导出 iframe 按外到内排列。OA 改版后更新配置并重新验收。
- 设置 `OA_LAB_ENV_FILE` 指向服务器既有 `lab.env`，则导出后执行编译后的增量入口，读取本机数据库配置；留空时只导出。入库须先完成工作台迁移 `009_material_usage.sql`。展示部门在网页服务的 `MATERIAL_DISPLAY_DEPARTMENTS_JSON` 中设置，不限制入库范围。

```bash
npm ci --ignore-scripts --prefix apps/oa-export
node apps/oa-export/src/cli.mjs --env .env --check
node apps/oa-export/src/cli.mjs --env .env
npm test --prefix apps/oa-export
```

`--check` 仅检查配置，不登录、不创建输出目录；启用入库时也检查 lab.env 和编译入口可读，不连接数据库。源码目录默认不带编译入口，启用入库须先构建并从安装包运行。正常运行默认单步超时 60 秒，下载超时 180 秒，入库子进程最多 120 秒，失败即退出，不自动重试。OA 报表会把 HeadlessChrome 标识判为低版本浏览器；程序使用同版本普通 Chrome 标识。登录后的非强制提示可用 `OA_LOGIN_DISMISS_SELECTOR` 关闭；当前密码提示按用户要求忽略，不更改密码；若后来无法继续访问，任务失败退出。

## 文件与状态

成功后以 `materials-<UTC时间>-<随机标识>.<扩展名>` 保存，避免同名覆盖；不沿用可能包含业务信息的原始文件名。下载先写 `.partial`，核验非空、表格扩展名、明显的登录 HTML 及 xlsx ZIP 文件头后再改为正式文件。入库前进一步校验表头和采购组合键；这些检查不能证明 OA 导出范围完整，首次上线仍需人工核对。

失败不修改历史导出文件，入库失败时保留已下载文件且数据库事务回滚。程序在 finally 中关闭临时会话并清理未完成文件。错误记录只有时间、阶段、固定状态码；成功记录包含通用文件名、字节数及新增/更新/未变化计数，不写 OA 地址、账号、密码、cookie 或物料行。生产导出程序不会生成页面截图、HTML 快照或网络跟踪。

输出目录的 `runs.jsonl` 记录每次已启动任务的状态。启动配置错误或重复运行锁错误通过退出码和外层日志呈现。输出目录 `.run.lock` 防止同机重复运行；若进程被强制终止可能留下锁，确认没有导出进程后，管理员才能移除此锁和残留 `.partial`。当前阶段保留历史导出，不自动清理；目录仅管理员与 SYSTEM 可读。

## Windows 独立部署

导出与任务有独立安装包；启用增量入库前，需要先部署新网页、执行迁移并配置展示部门。当前已完成部署；以下保留安装与验收步骤。升级或更换任务身份前须核对目标、配置、备份及回滚步骤。

1. 本机先安装 `apps/web` 开发依赖，再执行 `bash infra/windows/build-oa-export.sh`，输出 `dist/oa-export.zip`。打包源码、固定依赖、运行入口和编译后的 `import-materials.mjs`；不包含 env、业务文件或测试数据库。
2. 把包放到 `C:\lab-workspace\incoming\oa-export.zip`，将安装脚本 `infra/windows/install-oa-export.ps1` 单独上传。准备受限的 `C:\lab-workspace\config\oa.env`，使用服务器输出路径与 Edge channel。
3. 管理员运行 `powershell -NoProfile -ExecutionPolicy Bypass -File <安装脚本路径>`。安装到 `C:\lab-workspace\automation\oa-export`，输出到 `E:\lab-workspace\oa-materials`；存在同名任务或程序目录时拒绝覆盖。安装脚本不读取或修改 `lab.env`，不改网络、防火墙、数据库或现有任务。
4. 注册 `LabWorkspace-OA-Export`：安装脚本执行者的现有管理员账号，S4U 无密码登录、最高权限，每周六 03:00，单次最多 10 分钟，禁止任务重叠，不设置失败重试。不要求账号保持交互登录，也不保存 Windows 密码。该机实测 Edge 在 SYSTEM 下启动即以 1002 退出，现有管理员 S4U 下可完成全流程；因此不使用 SYSTEM 运行浏览器。任务账号须保留管理员权限以读取受限配置和输出。错过运行时间时等待下个周六，暂无额外通知渠道。
5. 首次手动 `Start-ScheduledTask -TaskName LabWorkspace-OA-Export`。任务结束后检查 `Get-ScheduledTaskInfo -TaskName LabWorkspace-OA-Export` 的 `LastTaskResult=0`、`NextRunTime`，核对输出文件非空且 XLSX 结构可读，并核对入库计数、部门展示、原标记及申请仍保留。日志为 `E:\lab-workspace\logs\oa-export.log` 和输出目录 `runs.jsonl`。

## 停用与回滚

管理员先 `Disable-ScheduledTask -TaskName LabWorkspace-OA-Export`，等待正在执行的导出和入库结束。确认无运行实例后，可注销这一任务并移除新增程序目录。账号配置、历史导出和日志默认保留，需要删除时单独确认。数据库已迁移后不可直接恢复旧版整表替换导入程序，以免丢失本地标记；数据库和网页回滚须按备份另行确认。
