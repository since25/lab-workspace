# 常用耗材库存与核对

## 范围

「部门物料」继续用于查询 OA 采购记录；新增的「常用耗材库存核对」用于细胞房高频耗材的**实物库存**。两者分表保存：

- `material_items`：采购记录，管理员导入/OA 每周增量同步，代表「买过什么」。
- `consumable_stock`：库存条目，代表「现在还有多少」，数量只由人工核对改变。
- `consumable_stock_checks`：每次核对的历史（改前、改后、操作人、时间、备注）。

这样 OA 同步、采购字段更新都不会覆盖库存；库存也不会被误当成采购数量。

## 类别配置

默认类别（代码内置）：

| 类别 | 默认匹配关键词（用于从采购记录生成候选） |
|---|---|
| 吸头 | 吸头、枪头、tip、tips、滤芯吸头 |
| 细胞培养板 | 培养板、孔板、培养皿、transwell、小室、insert |
| 移液管 | 移液管、pipette、serological、巴氏吸管、吸管 |
| 离心管 | 离心管、ep管、eppendorf、冻存管、cryovial |
| 培养基 | 培养基、dmem、rpmi、f12、f-12、memα、mem-α、medium、血清、fbs |

可通过网页服务的环境变量覆盖：

```bash
MATERIAL_STOCK_CATEGORIES_JSON='[{"name":"吸头","keywords":["吸头","枪头","tip"]},{"name":"培养基","keywords":["培养基","dmem"]}]'
```

- 支持只写名称：`["吸头","培养基"]`，此时沿用内置关键词；未内置的名称没有关键词，不会自动匹配采购记录，但仍可手动新增条目。
- 名称须唯一、非空；关键词须为字符串数组。配置损坏时库存接口返回 503，并在页面显示「常用耗材类别配置无效，请联系管理员」。
- 类别是**平铺列表**，不是树；需要层级时可后续扩展。真实类别名称和关键词不要写进 Git。

## 权限

| 操作 | 普通成员 | 管理员 |
|---|---|---|
| 查看库存、按类别汇总、查看核对历史 | 可以 | 可以 |
| 新增/编辑/删除耗材条目 | 不可以 | 可以 |
| 核对数量 | 不可以 | 可以 |
| 从采购记录生成候选 | 不可以 | 可以 |
| 提交库存校对请求（数量建议 + 采购记录标记） | 可以，待管理员批准 | 可以，待批准 |
| 批准/驳回库存校对请求 | 不可以 | 可以 |

与现有「物料维护仅管理员」的边界一致。成员或 agent 不直接改库存，而是提交「库存校对请求」；管理员批准后才生效。agent 通过 MCP 使用普通成员账号，详见 [`agent-mcp.md`](agent-mcp.md)。

## 状态口径

| 状态 | 条件 | 说明 |
|---|---|---|
| 待核对 | `last_checked_at IS NULL` | 数量未知，页面显示「—」；不计入已用完/偏低 |
| 已用完 | 已核对且 `quantity <= 0` | 红色；接口状态仍为 `out` |
| 偏低 | 已核对且 `safety_stock > 0` 且 `quantity <= safety_stock` | 黄色；安全库存为 0 时不会触发偏低 |
| 正常 | 其余 | 绿色 |
| 待复核 | 已核对且超过 30 天未再核对 | 状态不变，额外显示文字；30 天为常量 `STOCK_STALE_DAYS` |

「从采购记录生成候选」新建的条目数量为 0、`last_checked_at` 为空，因此显示「待核对」，不会立刻报已用完。

## 核对与并发

- 核对提交 `{ quantity, note, expected_revision }`；服务端在事务中锁定该行，比较 `revision`，不一致返回 409「库存刚刚被其他人更新，请刷新后重新核对」。
- 核对成功后 `revision + 1`、`last_checked_at = now()`、`last_checked_by = 当前用户`，并写入一条 `consumable_stock_checks`。
- 编辑只能改类别、名称、品牌、规格、单位、安全库存、备注；传 `quantity` 会被拒绝，提示走「核对」。
- 删除会级联删除核对历史，并在审计日志写入条目快照（类别/名称/品牌/规格/数量）；有等待审批的库存校对请求时拒绝删除（409）。

## API

完整定义见 `api-contract.md`。示例：

```bash
# 列表（可按 category/q/status 过滤；status: unchecked|out|low|ok|stale）
curl -b cookie.txt 'http://127.0.0.1:3000/api/v1/materials/stock?category=吸头'

# 新增（管理员）
curl -b cookie.txt -H 'Content-Type: application/json' -X POST \
  -d '{"category":"吸头","item_name":"200ul 滤芯吸头","brand":"示例品牌","spec_model":"EXAMPLE-TIP","unit":"盒","quantity":10,"safety_stock":3}' \
  http://127.0.0.1:3000/api/v1/materials/stock

# 核对（管理员；expected_revision 取自列表响应）
curl -b cookie.txt -H 'Content-Type: application/json' -X POST \
  -d '{"quantity":6,"note":"周五盘点","expected_revision":2}' \
  http://127.0.0.1:3000/api/v1/materials/stock/1/check

# 核对历史
curl -b cookie.txt 'http://127.0.0.1:3000/api/v1/materials/stock/1/checks?limit=20'

# 从当前展示部门的采购记录生成候选（管理员）
curl -b cookie.txt -X POST http://127.0.0.1:3000/api/v1/materials/stock/sync
```

## 页面操作

1. 登录后点顶部独立选项卡「常用耗材」（与「部门物料」并列，不再藏在部门物料页面里）。
2. 默认显示全部类别；点类别选项卡过滤。顶部显示总数、待核对、已用完、低于安全库存、待复核。
3. 管理员点「新增耗材」建立条目；初始库存留空表示待核对。
4. 管理员点某行「核对」，填实际数量与备注（领用/报损/盘点说明），保存后列表刷新，点「历史」看台账。
5. 管理员点「从采购记录生成候选」，按类别关键词匹配展示部门内的启用记录，只新增缺失条目，不修改已有库存。
6. 普通成员只能查看和看历史，没有新增/核对/编辑/删除/生成候选按钮。

成员或 agent 还可以提交「库存校对请求」，把一次盘点同时关联库存数量和采购记录，管理员在「物料审批 → 库存校对」批准后生效。接口与 agent 用法见 [`agent-mcp.md`](agent-mcp.md)。

## 迁移与部署

- 迁移文件：`db/migrations/011_consumable_stock.sql`（库存表）与 `db/migrations/012_stock_reconcile.sql`（库存校对请求）；迁移按文件名排序执行。
- 升级时执行 `node apps/web/scripts/migrate.mjs`（读取 `DATABASE_URL`），或在 Windows 安装包流程中自动执行。
- 新环境变量加到 `C:\lab-workspace\config\lab.env`；不配置时使用内置五类。
- 迁移只新增表，不修改 `material_items`，不需要清洗历史采购记录；回滚可按备份恢复到迁移前，但会丢失迁移后的核对记录。

## 验收与测试

```bash
cd apps/web
npx vitest run                 # 含库存、库存校对、路由测试
npx tsc --noEmit
npm run build
node scripts/check-consumable-stock-ui.mjs   # 需要 Chromium；截图输出 tmp/consumable-stock-ui-check/
node scripts/check-reconcile-ui.mjs          # 审批页；截图输出 tmp/reconcile-ui-check/

cd ../mcp-server
npm test                       # 用 mock HTTP + 真实 MCP stdio 客户端
```

测试使用内存 PostgreSQL（PGlite）执行真实迁移和 SQL，覆盖：类别配置、分类匹配、状态口径、新增/编辑/删除、核对台账、revision 冲突、分类汇总、采购候选同步、库存校对提交/审批/过期 revision、成员/管理员权限、数据库异常不泄露内容。

## 明确不做

- 不自动按采购数量推算库存，不自动扣减。
- 不自动生成 OA 请购单或补货单；低库存只提示。
- 不做库位、批次、效期、序列号；如后续需要，按 `material-inventory-research.md` 的升级路径另行评估。
- 不向普通成员开放直接改库存；成员/agent 只能提交待管理员批准的库存校对请求。
- 不自动创建耗材条目、不自动批准 agent 请求、不自动生成 OA 请购单。
- 不在页面或日志中展示真实部门、账号、采购明细。
