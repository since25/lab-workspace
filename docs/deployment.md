# 部署与运维（windows-wg）

## 1. 部署形态

| 组件 | 位置 | 运行方式 | 端口 |
|---|---|---|---|
| 网页（Next.js 独立构建） | `C:\lab-workspace\app\web` | 计划任务 `LabWorkspace-Web`，开机以 SYSTEM 启动 `deploy\run-web.ps1` 守护循环 | 3000（对外） |
| 分析服务（R plumber） | `C:\lab-workspace\app\r-engine` | 计划任务 `LabWorkspace-R`，`deploy\run-r.ps1` 守护循环 | 8001（仅本机） |
| 数据库 PostgreSQL 16 | 程序 `C:\lab-workspace\pgsql`，数据 `E:\lab-workspace\pgdata` | Windows 服务 `lab-workspace-postgresql`（Network Service） | 5432（仅本机） |
| 运行环境 | `C:\lab-workspace\node`、`C:\lab-workspace\R` | — | — |
| 配置 | `C:\lab-workspace\config\lab.env`（仅 SYSTEM 与管理员可读） | — | — |
| 分析临时文件 | `E:\lab-workspace\jobs`，24 小时后自动删除 | — | — |
| 日志 | `E:\lab-workspace\logs\web.log`、`r-engine.log`、`backup.log`；数据库日志在 `pgdata\log` | — | — |
| 备份 | `E:\lab-workspace\backups`，每天 02:30，保留 30 天 | 计划任务 `LabWorkspace-Backup` | — |

防火墙规则 `LabWorkspace-Web-In-TCP-3000` 只放行单位内网 `10.129.0.0/16` 与 WireGuard 内网 `192.168.7.0/24`。如同事电脑不在这两个网段，需要在该规则里补充来源。

本系统不占用、不修改同机的标签打印服务（8080）与 MariaDB（3306）。

### 常用耗材类别配置（可选）

`lab.env` 可增加 `MATERIAL_STOCK_CATEGORIES_JSON`，覆盖默认的「大类/子类」类别与采购记录匹配关键词；不配置时使用内置四大类（普通用品/塑料耗材/生物试剂/试剂盒）+ 其他。升级到两级分类版本时，若 `lab.env` 里还留着旧五类配置，需删除该行或换成新格式，否则标签卡仍是旧五类。格式与注意事项见 [`consumable-stock.md`](consumable-stock.md)。升级到包含 `011_consumable_stock.sql` / `012_stock_reconcile.sql` / `013_consumable_slots.sql` 的版本时，安装脚本会自动执行迁移；迁移只新增库存相关的表和列，不修改既有采购记录。2026-10-21 起默认类别改为槽位模板的五大类（细胞耗材/塑料耗材/通用耗材/培养基/常用试剂）+ 其他，上线后由管理员依次「建立槽位模板 → 匹配采购记录 → 核对工作台确认 → 第一次核对」。真实类别与部门名称不写入安装包或 Git。

agent 用的 MCP 服务不部署在 windows-wg，而由使用 agent 的电脑以 stdio 启动，通过 HTTP 连接工作台；使用普通成员账号，批准仍在网页「物料审批 → 库存校对」完成。安装与配置见 [`agent-mcp.md`](agent-mcp.md)。

## 2. 生成安装包（开发机 macOS）

```bash
bash infra/windows/build-bundle.sh
```

输出 `dist/bundle/`：`app.zip`（应用）、`deploy/`（脚本）、`runtime/`（Node、PostgreSQL、R 安装文件与 R 包离线仓库）。该机国际下载不稳定，所有运行环境都在开发机下载后拷过去，安装过程不访问外网。

## 3. 首次安装

1. 把 `dist/bundle/` 整个拷到目标机 `C:\lab-workspace\incoming\`。
2. 管理员 PowerShell 执行：`powershell -ExecutionPolicy Bypass -File C:\lab-workspace\incoming\deploy\install.ps1`。经 SSH 远程安装时，建议建一次性 SYSTEM 计划任务执行并把输出重定向到 `E:\lab-workspace\logs\install.log`，避免断线中断安装，完成后删除该任务。
3. 创建第一个管理员（密码通过环境变量传入，不进命令历史）：
   ```powershell
   $env:DATABASE_URL = (Select-String -Path C:\lab-workspace\config\lab.env -Pattern '^DATABASE_URL=(.*)').Matches[0].Groups[1].Value
   $env:ADMIN_PASSWORD = '<初始密码>'
   C:\lab-workspace\node\node.exe C:\lab-workspace\app\scripts\create-admin.mjs <用户名> <姓名>
   Remove-Item Env:\ADMIN_PASSWORD, Env:\DATABASE_URL
   ```
4. 浏览器打开 `http://<目标机地址>:3000`，用管理员登录：
   - 「账号管理」创建同事账号；
   - 「细胞冻存 → 导入登记表」导入原《细胞冻存登记表》；
   - 「部门物料 → 导入采购导出」导入采购系统导出。

## 4. 升级

开发机重新执行 `build-bundle.sh`，只需把新的 `app.zip` 与 `deploy/` 覆盖到 `C:\lab-workspace\incoming\`，再执行一次 `install.ps1`。脚本会停旧进程、替换 `app\`、执行新的数据库迁移并重启；运行环境、配置与数据不受影响。

## 5. 日常检查

- 网页与分析服务为常驻任务，`ExecutionTimeLimit` 必须为 `PT0S`（无限）；Windows 默认的 `PT72H` 会在三天后连同守护循环一起终止。安装脚本在注册这两个任务后显式取消时限；备份与 OA 同步任务保持各自原有时限。
- 健康检查：`http://<地址>:3000/api/v1/health` 返回 `{"status":"ok","db":true,"r_engine":true}`。
- 服务状态：`schtasks /Query /TN LabWorkspace-Web`、`Get-Service lab-workspace-postgresql`。
- 手动重启网页或分析服务：`schtasks /End /TN LabWorkspace-Web` 后 `schtasks /Run /TN LabWorkspace-Web`（R 同理）。

## 6. 备份与恢复

- 手动备份：`powershell -File C:\lab-workspace\deploy\backup.ps1`。
- 恢复（会覆盖当前数据，先停网页服务）：
  ```powershell
  $env:PGPASSWORD = '<lab.env 中 DATABASE_URL 的密码>'
  C:\lab-workspace\pgsql\bin\pg_restore.exe -h 127.0.0.1 -U lab_app -d lab_workspace --clean --if-exists E:\lab-workspace\backups\<文件>.dump
  ```

## 7. 卸载 / 回滚

`powershell -File C:\lab-workspace\deploy\uninstall.ps1`：移除计划任务、防火墙规则与数据库服务，保留 `E:\lab-workspace` 数据。确认不再需要后手动删除 `C:\lab-workspace` 与 `E:\lab-workspace`。

## 8. 该机的已知约束

- Windows 10 LTSC 2019 上 R 的本地编码是 GBK。`start.R` 已设 `options(encoding = "UTF-8")`；R 源码中不得出现 GBK 无法表示的字符（emoji、数学减号等），否则 `source()` 会静默截断文件。`apps/r-engine/tests/test_gbk_safe.R` 负责检查。
- PowerShell 5.1：含中文的 `.ps1` 必须是 UTF-8 带 BOM；多行代码不要用 `Rscript -e` 传参。
- 不支持 Docker / WSL2；国际下载不稳定，运行环境一律在开发机下载。

## 9. 本地开发

- 数据库：任意 PostgreSQL 16，`DATABASE_URL=postgres://...`，`node apps/web/scripts/migrate.mjs` 建表，`ADMIN_PASSWORD=... node apps/web/scripts/create-admin.mjs admin 管理员`。
- 分析服务：`cd apps/r-engine && LAB_TEMP_DIR=/tmp/lab_jobs Rscript start.R`（需 R 4.5 与 `build-rpkgs.R` 中列出的包）。
- 网页：`cd apps/web && npm install && npm run dev`。
- 测试：`cd apps/web && npx vitest run`；`cd apps/r-engine && Rscript tests/<文件>.R`。

## 10. OA 部门物料导出（独立部署）

OA 流程使用单独的程序目录和每周六计划任务，每次重新登录后通过网页下载，按配置增量写入部门物料库，保留本地已用完及待审批状态。2026-10-15 已部署新网页、执行迁移 `009_material_usage.sql`、配置两个展示部门并启用增量入库。任务 `LabWorkspace-OA-Export` 每周六北京时间 03:00 执行，使用安装时的现有管理员账号 S4U 无密码登录；该机 Edge 无法在 SYSTEM 下启动。`lab.env` 的部门 JSON 必须使用无外层引号的单行 ASCII（中文用 `\uXXXX` 转义），以兼容 PowerShell 5.1 的读取方式。不可启用旧的整表替换逻辑。详见 [`materials-update-plan.md`](materials-update-plan.md) 与 [`oa-material-export.md`](oa-material-export.md)。

## 11. 固定资产展示部门

台账是**全量入库**（所有部门），页面能看哪些部门由 `lab.env` 的 `ASSET_DISPLAY_DEPARTMENTS_JSON` 决定：

- 未配置：默认只展示「研发部」（线上当前即此状态，不需要改配置）。
- 配置多个部门：`ASSET_DISPLAY_DEPARTMENTS_JSON=["\u7814\u53d1\u90e8","\u5206\u6790\u5e73\u53f0"]`（`研发部`、`分析平台`）。JSON 与物料一致，必须是**单行、纯 ASCII、中文用 `\uXXXX`**，否则 PowerShell 5.1 读到的中文会乱码。
- 配置 `["*"]`：不限部门，页面上出现「使用部门」筛选与部门列。
- 改完配置后执行 `schtasks /End /TN LabWorkspace-Web` + `schtasks /Run /TN LabWorkspace-Web` 让网页服务重新读取。

增加部门、增加台账条目都只需要改配置或重新导入台账，不需要改代码。迁移 `010_asset_codes.sql` 之后必须由管理员在「固定资产 → 导入台账」重新导入一次《固定资产台账》，资产编号和研发部以外的部门才会进入数据库。
