# 2026-10-16 固定资产台账全量入库与「按物品汇总」视图

## What was done

**导入改为全量入库（不再只导研发部）**

- `parseAssetWorkbook` 现在写入台账里所有部门的行；是否展示由查询时的部门配置决定，以后加部门、加条目都不用改代码。
- 两套资产编号入库：`asset_code`（旧，ZX-…）与 `asset_code_new`（新，CMC-…）。台账里 `固定资产编号`、`固定资产新编号（2023.7月起）`、`更改后固定资产编号(20211102)` 三种列名都识别，`配套设备资产编号` 不误认。
- 修掉三类脏数据：表里重复出现的表头行（「未入账」旧版块会再写一次表头，原来会被当成一条资产）、「合计」行、缺少使用部门的行。跳过原因在导入预览里按「工作表 第N行：原因」列出。
- 导入预览新增按部门条数，替换条数改为台账全量条数（`total_rows`）。

**页面与接口**

- `GET /assets` 三种视图共用同一套筛选：`view=group`（默认，按「资产名称＋规格型号＋使用部门」汇总，100 组一页）、`view=item`（逐条明细，50 条一页）、`view=detail`（`name`＋`spec`＋`group_department` 展开一个分组，沿用当前筛选）。
- 汇总行给出 `item_count`、地点分布 `locations[{location,item_count,total_quantity}]`、使用人汇总；页面把它渲染成可点击的地点标签（`203 ×5`），点标签即按该地点筛选，再点取消。
- 搜索同时匹配名称、规格型号与两套编号；明细与展开行都显示资产编号（新编号为主，旧编号灰色附在下面）。
- 展示范围：`ASSET_DISPLAY_DEPARTMENTS_JSON`（`lab.env`），未配置默认只展示研发部，`["*"]` 表示不限部门。范围只有一个部门时自动隐藏部门筛选与部门列。

**真实数据核对**（`固定资产台账-20260120.xlsx`）

- 全量 498 条，其中研发部 226 条（与线上原有一致）、分析平台 83、体内工艺平台 67、体外工艺平台 32、行政部 30…共 20+ 个部门；跳过 6 行（2 条重复编号、3 行缺部门、1 行表头）。
- 研发部 226 条 ⇒ 汇总后 109 组：原来 5 页明细变成 2 页，同名同规格跨地点的 30 组（132 行）各自只占一行。最极端的 `Glison PG型可调移枪 / F144056M` 是 12 条、5 个地点。

## Testing

- 单测新增 `src/lib/assets-list.test.ts`（9 例，PGlite 跑真实 SQL）：全量解析与编号、表头/合计/缺部门行跳过、两种编号列兜底与跨表去重、展示范围配置（默认研发部 / 多部门 / `*` / 配置无效报错）、三种视图筛选一致、地点条数与展开明细一致、范围外部门用参数也拿不到、排序分页收敛、排序字段注入不生效。
- `npx vitest run` 58 例全过；`npx tsc --noEmit`、`npm run lint`（仅剩 3 条与本次无关的既有告警）通过；`npx next build` 通过。
- 本地用生产同款独立构建（`.next/standalone`）＋真实台账跑浏览器端到端：导入预览 498 条与逐行跳过原因、确认替换、109 组/226 条、展开 12 行、地点标签筛选（203 ⇒ 51 组）、按新编号前缀搜索 67 组、明细视图 50 条/页、无控制台报错。截图在 `tmp/assets-opt/shots/`。
- 多部门配置核对：`["研发部","分析平台"]` ⇒ 166 组、出现部门筛选与部门列，切到分析平台后部门列自动隐藏。
- 生产部署后核对：健康检查 `status=ok`（db、r_engine 均正常）；新 `010_asset_codes.sql` 已执行、两列已存在；线上 `/_next/static/chunks/1ky20yb27c-hv.js` 与本地构建 SHA-256 完全一致（`2dbf410a…`）且含「按物品汇总」；网页、R、OA 三个计划任务与 PostgreSQL 服务均正常。

## Changed files

- `db/migrations/010_asset_codes.sql`（新增）
- `apps/web/src/lib/imports/assets.ts`、`apps/web/src/lib/assets-list.ts`（新增查询层）、`apps/web/src/lib/assets-list.test.ts`（新增）
- `apps/web/src/app/api/v1/assets/route.ts`、`apps/web/src/app/api/v1/assets/import/route.ts`
- `apps/web/src/app/(app)/assets/page.tsx`、`apps/web/src/app/globals.css`
- `docs/data-model.md`、`docs/api-contract.md`、`docs/deployment.md`、`README.md`

## Deploy

- 2026-10-16 10:04（服务器时间）部署到 windows-wg：app.zip 7,448,969 字节，SHA-256 `efdeae61…`，上传后比对一致；ZIP CRC 正常、包内无 `.env`/配置夹带。
- 部署前备份：`E:\lab-workspace\backups\lab_workspace_20261016_1004.dump`；安装结果 0，VERSION 由 `f7659c7` 变为 `2822d51`。
- Rollback：旧应用包 `C:\lab-workspace\incoming\app.prev-materials-ui-20261015_174416.zip`（7,444,601 字节），数据库备份见上；本次迁移只加两列且不删除数据，恢复旧包即可回到旧页面（新列留着不影响旧代码）。
- 临时部署任务与结果文件已删除，未改动 OA 任务与受限配置。

## Pending

- **需要管理员在「固定资产 → 导入台账」重新导入一次《固定资产台账》**，资产编号与研发部以外的 272 条才会进入数据库（当前仍是旧的 226 条、编号为空）。汇总视图不依赖重新导入，部署后立即可用。
