# 标签打印

## 1. 能力范围

工作台「标签打印」把三类记录按模板排成双列标签纸，经服务端代理交给本机标签打印服务（代码在 `apps/labelprint/`，Python）出纸。浏览器不直接访问 8080。

| 来源 | 取数 | 可打印字段 | 归属规则 |
|---|---|---|---|
| 部门物料 | `material_items` | 名称、物料编码、规格型号、品牌、部门、单位 | 按 `MATERIAL_DISPLAY_DEPARTMENTS_JSON` 展示部门 |
| 冰箱样品 | `freezer_samples`（仅 `stored`） | 样品信息、项目号、样品类型、位置、存入日期、备注 | 普通成员只看自己的；管理员或「冰箱总览」看全部 |
| 固定资产 | `fixed_assets` | 资产名称、资产编号、规格型号、存放地点、使用人、使用部门 | 按 `ASSET_DISPLAY_DEPARTMENTS_JSON` 展示部门 |

可见性按账号控制：`users.label_print_enabled`（与「冰箱总览」同一模型），管理员在「账号管理」勾选或关闭；关掉只影响入口与接口，不影响登录。

## 2. 纸张与画布

- 画布固定 703 × 178 点，对应 Brady BBP12 的 59.5 × 15.1 mm @300 dpi 双列标签纸；
- 一格 351 点宽（29.75 mm），两格之间留 1 点缝；格内四周留白：左右 15 点（约 1.27 mm）、上下 14 点；
- 一次提交按选择顺序两两配对：第 1 条落左列、第 2 条落右列；奇数最后一条只打左列、右列留空；
- 换纸张或换打印机时，需要同时校准 `SLOT_W`、`TWO_UP_GAP`、`SLOT_MARGIN_X`、`LABEL_W/H`。

尺寸由标签服务统一给出（`/api/media` → `MEDIA`），工作台只展示、不另写一份：模板选项标注「30 × 15 mm」，预览把位图套在一个固定外框里，外框左上标整张 `59.5 × 15.1 mm`、右下标单格 `30 × 15 mm`，中间虚线示意双列裁切。所有模板的预览外框尺寸完全一致，字号不同不会让人觉得打出来的纸不一样大。

## 3. 内置模板

模板只改字号与是否排字段，不改纸张；名称超宽时按 2 点步长自动缩字号，不换行。

| 模板 | 名称字号 | 字段字号 | 说明 |
|---|---|---|---|
| `name-detail` 名称 + 字段 | 34（最窄缩到 18） | 20（缩到 13） | 默认；第一个选中字段做大字标题 |
| `uniform` 等宽全字段 | 22（缩到 16） | 22（缩到 13） | 名称与字段同字号，信息密度高 |
| `name-only` 仅名称 | 46（缩到 24） | 不排字段 | 货架、抽屉、柜门 |

排版规则（2026-10-23 重做）：

- 名称最多 3 行、每条字段最多 2 行；拉丁字母/数字连写（`0.2ml`、`PCR`、`SFPES013122SI`）当作一个整体，只在中英文交界或空格处断行，不会把 `PCR` 拆成 `PC` / `R`；
- 两行能排下时优先用大字换行，而不是把字号缩到很小；只有排不下才逐档缩字号，缩到下限仍超出再截断字段；
- 内容整体在格内**垂直居中**，短名称不会贴在上边、下面空一大片；
- 同一行数下会挑左右更接近的断点，避免「……试剂 / 盒」这种孤字尾。

所以「同一张标签在不同模板下大小不同」是字号差异，不是纸张差异。字段顺序按勾选顺序，第一个字段永远是标题。

## 4. 打印流程

1. 页面选来源、勾选记录（跨页保留）、选模板与字段、填份数（1–20）；
2. 预览：服务端用同一套渲染参数生成 703×178 位图，页面只是显示；
3. 提交：工作台写入 `label_print_jobs`（`template` 记 `来源:模板`），再带 `layout:"two-up"`、`template`、`printer_id`、`copies` 调标签服务；
4. 标签服务把位图转 TSPL，RAW 提交到对应 Windows 打印队列；接口只保证「作业已送出」，是否出纸以现场为准。

## 5. 打印机

`label_printers` 是全局设备目录，工作台管理员维护显示名、启停和默认设备；实际队列名由标签服务的 `LABELPRINT_PRINTERS_JSON` 决定。当前线上只有 Brady BBP12。POSTEK C168/300s 需要单独的 EPL 输出后端，见 TASK-91 与 `docs/label-print-postek-epl.md`。

## 6. 部署与版本（2026-10-23 起，TASK-94）

标签打印服务与工作台同仓库、同安装包、同版本，选型理由见 [`decisions.md`](decisions.md)「标签打印统一工程化」。

| 项目 | 位置 / 做法 |
|---|---|
| 源码与测试 | `apps/labelprint/`（`labelprint/` 包、`tests/` pytest、`verify.bat` 自检） |
| 线上代码 | `C:\lab-workspace\app\labelprint`，随 `app.zip` 整体替换 |
| Python | 嵌入版 3.13.15 装在 `C:\lab-workspace\python`；依赖版本锁定在 `apps/labelprint/requirements-win.txt`（与校准时线上一致：Pillow 12.3.0、pywin32 312） |
| 守护与自启 | 计划任务 `LabWorkspace-LabelPrint` → `deploy\run-labelprint.ps1`，SYSTEM、开机启动、不限运行时长；取代旧任务 `LabelPrintService` |
| 配置 | `lab.env` 中 `LABELPRINT_` 开头的项（如 `LABELPRINT_PRINTERS_JSON`）；历史库路径默认 `C:\labelprint\data\labelprint.db` |
| 日志 | `E:\lab-workspace\logs\labelprint.log` |
| 版本 | `app\VERSION` 一份；`GET http://127.0.0.1:8080/api/status` 返回同一个 `version` |
| 历史库备份 | 每次安装前自动复制到 `E:\lab-workspace\backups\labelprint_<时间>.db` |

**开发与测试**：`cd apps/labelprint && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python -m pytest -q`。改 `render.py` 后仍须在目标机跑一次自检（桌面「标签打印 - 自检」）再算验证。

**升级**：与工作台相同，`bash infra/windows/build-bundle.sh` 后把 `app.zip`、`deploy\` 覆盖到 `C:\lab-workspace\incoming\`，执行 `install.ps1`。`runtime\` 里的 Python 两个 zip 只在首次或 `requirements-win.txt` 变化（文件名摘要变化）时需要一并拷过去；安装脚本按文件名判断是否重装依赖。安装日志末尾依次出现「网页服务已启动」「标签打印服务已启动（版本 xxx，打印机就绪/未就绪）」才算两端都成功；版本不一致会报错退出。

**回滚**：恢复上一份 `app.zip` 与同版本 `deploy\` 后重跑 `install.ps1`，网页与标签服务一起回到旧版；历史库不受影响。若要回到并入之前（TASK-94 之前）的版本：先 `schtasks /End /TN LabWorkspace-LabelPrint` 并 `schtasks /Delete /TN LabWorkspace-LabelPrint /F`，再用 `C:\labelprint` 下保留的旧代码执行 `powershell -ExecutionPolicy Bypass -File C:\labelprint\deploy\install.ps1` 单独恢复旧服务（它使用系统 Python 与原 `data\`）。
