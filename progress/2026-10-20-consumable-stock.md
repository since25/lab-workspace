# 常用耗材库存、库存校对与 agent MCP（TASK-56）及采购/开源调研（TASK-57）

- 日期：2026-10-20
- 工作区：`/Users/wangyichuan/localissue/lab-workspace-task-56`
- 分支：`task-56`（基于 `main` 提交 `2822d51`；主工作区与主分支未改动，未提交/推送/部署）
- 关联任务：TASK-56（feature）、TASK-57（investigation）

## 1. 交付内容

### TASK-56：库存与核对

- `db/migrations/011_consumable_stock.sql`
  - `consumable_stock`：类别、名称、品牌、规格、单位、当前数量、安全库存、备注、最近核对人/时间、`revision` 乐观锁、创建/更新人；唯一键 `(category,item_name,brand,spec_model)`。
  - `consumable_stock_checks`：每次核对的改前/改后、操作人、时间、备注。
  - 只新增表，不修改 `material_items`。
- `apps/web/src/lib/consumables.ts`
  - `MATERIAL_STOCK_CATEGORIES_JSON` 解析（名称或名称+关键词）、默认五类、NFKC 归一化分类、状态/待复核/数量校验。
- `apps/web/src/lib/consumable-stock.ts`
  - 列表与类别汇总、创建/编辑/删除、核对台账、revision 冲突检测、从采购记录生成候选、审计。
- 页面与 API
  - 顶部独立选项卡「常用耗材」→ `/materials/stock`：类别选项卡、状态徽标（待核对/已用完/偏低/正常/待复核）、核对/历史/新增/编辑/删除/生成候选。
  - `/materials` 不再重复放入口，只保留「剩余库存与核对见顶部常用耗材」提示；10 个采购列不变。
  - `GET/POST /api/v1/materials/stock`、`PATCH/DELETE /:id`、`POST /:id/check`、`GET /:id/checks`、`POST /sync`。

### TASK-56：库存校对请求与管理员审批

- `db/migrations/012_stock_reconcile.sql`
  - `stock_reconcile_requests`：库存条目、提交时快照（名称/数量/revision）、建议数量、采购记录 ID 数组、说明、状态、提交人/审批人/时间。
  - 同一耗材只允许一条待审批请求；批准时校验 revision，避免覆盖别人刚改过的库存。
- `apps/web/src/lib/stock-reconcile.ts`
  - 检索上下文（库存 + 采购 + 近 N 月未收货/部分收货 + 建议 ID）、提交请求、列表/详情、管理员批量批准/驳回。
  - 批准在一个事务内：改库存、写 `consumable_stock_checks`、把采购记录标记为已用完并清除待审批申请字段。
- API
  - `GET /api/v1/materials/reconcile/search`
  - `POST /api/v1/materials/reconcile`
  - `GET /api/v1/materials/reconcile[/:id]`
  - `GET/POST /api/v1/admin/materials/reconcile`
- 管理页面
  - `/admin/materials/reconcile`：待审批/全部/已批准/已驳回；显示库存提交时→建议、当前库存、采购记录明细、提交人/说明；批准/驳回；库存已变化时禁止批准并提示驳回。
  - 顶部管理导航新增「库存校对」；`/admin/materials` 工具栏也加入口。

### TASK-56：agent MCP

- `apps/mcp-server/`（独立 Node 包，stdio MCP）：
  - `search_consumable`：查库存、采购、近 N 月未收货标记、建议采购记录 ID。
  - `submit_stock_reconciliation`：仅在用户确认后提交待审批请求。
  - `get_stock_reconciliation`：查请求状态。
  - 使用普通成员账号登录现有 HTTP API，会话过期自动重登；不提供批准工具。
- `docs/agent-mcp.md`、`apps/mcp-server/README.md`、`.env.example`
- 测试 `apps/mcp-server/test/server.test.mjs`：本地 mock HTTP + 真实 MCP stdio 客户端。

### TASK-57

- `docs/material-inventory-research.md`：
  - 已核实的 OA 周同步/增量匹配/字段限制；
  - 可直接执行的采购周期 SQL（按小类、按物料）；
  - 10 条访谈提纲、四周盘点模板与安全库存公式；
  - InvenTree / Part-DB / Grocy / Snipe-IT / OpenBoxes / HomeBox / django-lab-inventory / Inventarium 的星数、许可、技术栈、盘点与最低库存能力评估；
  - 「不部署外部系统、在 lab-workspace 内做小模块」的选型建议及升级路径。

## 2. 页面操作

### 常用耗材

1. 登录工作台，顶部点独立选项卡「常用耗材」（与「部门物料」并列）。
2. 按类别选项卡过滤；顶部显示总数、待核对、已用完、低于安全库存、待复核。
3. 管理员：新增耗材、逐行核对（填实际数量/备注，写核对历史）、编辑、删除、从采购记录生成候选。
4. 普通成员：只读，可看核对历史。

### 库存校对（人工或 agent 提交）

1. 成员/agent 调用检索，确认后提交请求；提交后库存、采购记录都不变。
2. 管理员打开「物料审批 → 库存校对」（或顶部「库存校对」）。
3. 核对建议数量和采购记录，点「批准」：库存更新、写核对历史、采购记录标为已用完。
4. 若提交后库存被其他人改过，页面提示「库存已变化，请驳回」，批准按钮禁用。

### agent 对话示例

```text
用户：24孔板用完了
agent：调用 search_consumable("24孔板", 2)
       复述：当前库存 2 箱（低于安全库存）；近 2 个月 1 条采购未收货；
             历史采购 12 条，其中 3 条仍可标记。
agent：询问是否把 3 条采购标记为已用完、库存改为 0。
用户：确认
agent：submit_stock_reconciliation({stock_id, proposed_quantity:0, material_ids:[...], confirmed:true})
       告知：已提交请求 #12，等待管理员批准。
管理员：在「库存校对」批准 → 库存 0、采购记录已用完、请求已批准。
```

## 3. 验证命令与结果

在 `apps/web` 下：

```bash
npx vitest run
npx tsc --noEmit
npm run build
node scripts/check-consumable-stock-ui.mjs
node scripts/check-reconcile-ui.mjs
node scripts/check-materials-ui.mjs
```

在 `apps/mcp-server` 下：

```bash
npm test
```

| 命令 | 实际结果 |
|---|---|
| `npx vitest run` | **11 个测试文件、85 个测试全部通过**（库存 13、库存校对 11、相关路由 12；原 49 个仍通过）。 |
| `npx tsc --noEmit` | 通过（全新 worktree 需先 `npm run build` 生成 Next 类型）。 |
| `npm run build` | 通过；路由包含 `/materials/stock`、`/admin/materials/reconcile`、`/api/v1/materials/reconcile*`、`/api/v1/admin/materials/reconcile` 等。 |
| `node scripts/check-consumable-stock-ui.mjs` | 通过：独立顶部选项卡、最长路径高亮、部门物料不再重复入口、成员只读、类别汇总、管理员核对、新增默认待核对、历史、生成候选。 |
| `node scripts/check-reconcile-ui.mjs` | 通过：待审批列表、库存变化禁止批准、批准写回、驳回原因、全部状态。 |
| `node scripts/check-materials-ui.mjs` | 通过（原有 10 列/审批/导入流程无回归）。 |
| `npm test --prefix apps/mcp-server` | 2 个测试通过：登录 Cookie 复用、检索、未确认拒绝提交、确认后提交、状态查询、缺少配置不泄露密码。 |
| `npm run lint` | 0 error；3 个原有 `window.location.href` 警告（TopBar/login/client）。 |

浏览器检查使用 `apps/oa-export/node_modules/playwright-core` 与本机 Chromium，页面为实际 React 组件，API 为虚构响应；不等于生产端到端验收。

### 截图（虚构数据，位于 gitignored 的 `tmp/`）

- `tmp/consumable-stock-ui-check/nav-before.png`：改动前导航，无「常用耗材」。
- `tmp/consumable-stock-ui-check/nav-after.png`：独立「常用耗材」选项卡及管理员「库存校对」。
- `tmp/consumable-stock-ui-check/after-materials.png`：部门物料页不再重复入口。
- `tmp/consumable-stock-ui-check/member-stock.png`：成员只读。
- `tmp/consumable-stock-ui-check/admin-stock.png` / `admin-checked.png`：管理员视图与核对后刷新。
- `tmp/reconcile-ui-check/admin-reconcile.png`：库存校对审批列表（含库存变化禁止批准）。
- `tmp/reconcile-ui-check/admin-reconcile-done.png`：批准/驳回后。

## 4. 未测与限制

- **未连接生产库**：迁移与 SQL 只在 PGlite 内存库用虚构数据执行；未在 windows-wg 生产库执行 `011`/`012`，未验证真实数据量下的性能。
- **未部署**：未提交、推送、部署，未跑服务端真实登录/权限/浏览器验收。
- **未跑真实 OA 同步**：未验证「OA 同步后库存不被覆盖」的生产链路（代码层面库存/校对表不在同步语句中）。
- **未接真实 pi agent**：MCP 用官方 SDK 客户端做了 stdio 集成测试，但没有在 pi agent 的真实配置中运行；不同 MCP 客户端的配置键名可能不同。
- **采购周期数值未测**：无生产库只读权限、未访谈部门；报告提供 SQL 与盘点模板，具体交期/消耗/安全库存需部门确认后补。
- **权限选择**：库存写操作、库存校对审批仅管理员；agent 建议使用普通成员账号。若需要成员直接核对，应另加审批流程。
- **开源项目未实际部署**：评估基于 GitHub API 与官方文档，未在 windows-wg 上做 PoC。

## 5. 回滚

- 代码：丢弃 `task-56` 分支或 worktree 即可；主分支未改动。
- 数据库：`011`/`012` 只新增表；回滚按部署前备份恢复。删除表会丢失库存、核对历史和校对请求，但不影响 `material_items`。
