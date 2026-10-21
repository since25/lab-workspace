# 常用耗材库存与核对

## 范围

「部门物料」继续用于查询 OA 采购记录；新增的「常用耗材库存核对」用于细胞房高频耗材的**实物库存**。两者分表保存：

- `material_items`：采购记录，管理员导入/OA 每周增量同步，代表「买过什么」。
- `consumable_stock`：库存条目，代表「现在还有多少」，数量只由人工核对改变。
- `consumable_stock_checks`：每次核对的历史（改前、改后、操作人、时间、备注）。

这样 OA 同步、采购字段更新都不会覆盖库存；库存也不会被误当成采购数量。

## 类别配置（四大类 + 子类两级）

2026-10-20 起（TASK-63/66）类别改为两级：**标签卡 = 大类，行内子标签 = 子类**。`category` 字段存「大类/子类」（如 `塑料耗材/吸头`），标签卡按「/」前的大类前缀过滤；没有「/」的类别（如「其他」）自成一张卡。页面标签卡：

```
全部 ｜ 普通用品 ｜ 塑料耗材 ｜ 生物试剂 ｜ 试剂盒 ｜ 其他
```

默认类别（代码内置，`apps/web/src/lib/consumables.ts`；关键词只用于「从采购记录生成候选」，中英双语）：

| 大类 | 子类 | 关键词（节选） |
|---|---|---|
| 普通用品 | 手套 / 口罩帽鞋套 / 纸品清洁 / 标签打印 | 手套,丁腈,glove,nitrile / 口罩,鞋套,袖套,实验服,mask / 擦手纸,垃圾袋,酒精,75%乙醇,消毒,wipes / 标签,碳带,cryolabel |
| 塑料耗材 | 吸头 / 离心管冻存管 / 移液管 / PCR板连管封膜 / 培养板皿 / 瓶槽盒架 / 滤器 / 研磨管电转耗材 | 吸头,tip,combitips / 离心管,ep管,冻存管,cryovial / 移液管,serological / pcr板,pcr管,连管,封板膜,封膜 / 培养板,孔板,培养皿,培养瓶,transwell,dish,flask,wellplate / 加样槽,冻存盒,试剂瓶,血清瓶 / 滤器,细胞筛,超滤管,strainer / 裂解介质管,电转,nucleocuvette,cuvette |
| 生物试剂 | 培养基 / 添加物消化 / 转染 | 培养基,dmem,rpmi,imdm,opti-mem,methocult,medium / 血清,fbs,双抗,penicillin,胰酶,trypsin,pbs,生理盐水,冻存液 / 转染,lipofectamine,messengermax,polyplus,jetprime |
| 试剂盒 | 核酸提取纯化 / 分子克隆PCR / 逆转录RNA / 检测试剂盒 / 核酸染料 | quickextract,fastpure,isolation,磁珠 / master mix,premix,感受态,competent,无缝克隆 / 逆转录,trizol,hiscript / elisa,assay kit,检测试剂盒 / gelred,yeared,sybr |
| 其他 | （兜底，无关键词，管理员手动归位） | |

匹配规则：名称 + 规格 + OA 大小类合并后去空格、转小写（NFKC），命中多个类别时取**最长的关键词**（如「pcr板」优先于「孔板」，「elisa试剂盒」优先于「trypsin」），一样长时按配置顺序。不收「glutamax」：采购记录里它只出现在 RPMI/IMDM 培养基名称中，收了会把培养基误归添加物。

可通过网页服务的环境变量覆盖（改类别只改环境变量，不动代码）：

```bash
MATERIAL_STOCK_CATEGORIES_JSON='[{"name":"塑料耗材/吸头","keywords":["吸头","tip","combitips"]},{"name":"试剂盒/检测试剂盒","keywords":["elisa","assay kit"]},{"name":"其他","keywords":[]}]'
```

- 支持只写名称：`["塑料耗材/吸头","其他"]`，此时沿用同名内置类别的关键词；未内置的名称没有关键词，不会自动匹配采购记录，但仍可手动新增条目。
- 标签卡由配置里出现的大类决定（按首次出现顺序）；新增大类只需在配置里写「新大类/子类」。
- 名称须唯一、非空；关键词须为字符串数组，每个不超过 50 字；配置损坏时库存接口返回 503，并在页面显示「常用耗材类别配置无效，请联系管理员」。
- 新增关键词必须中英双语（教训：青链霉素台账全是英文名 PENICILLIN STREPTOMYCIN）。
- 内置表只放通用耗材名词和公开品牌/产品名；涉及真实部门、人员或采购明细的类别名/关键词放 `lab.env`，不写进 Git。
- 生产 `C:\lab-workspace\config\lab.env`：如果设置过旧的五类 `MATERIAL_STOCK_CATEGORIES_JSON`，升级时要删除该行（使用上表内置类别）或替换成新格式；保留旧值会让标签卡仍是旧五类。

## 从采购记录生成候选（TASK-66）

- 数据范围：`MATERIAL_DISPLAY_DEPARTMENTS_JSON` 配置的展示部门、`status <> '停用'` 的采购记录。
- 只取「复购品」：按名称 + 品牌 + 规格**异名归一后**合并，累计 ≥ 2 笔（`CANDIDATE_MIN_PURCHASES`）且近 12 个月内有采购（`CANDIDATE_RECENT_MONTHS`），并命中某个类别关键词。一次性长尾（抗体、原代细胞、定制物、耳标、饲料、脂质原料等）不进候选池，留在采购台账查看。
- 新建条目用最近一笔的写法，品牌换成别名表的标准名、规格做 200T 统一；数量 0、未核对。已存在同一归一键的条目（即使写法不同）不再新建。
- 以 2026-10-20 的展示部门采购导出离线验证：749 个原始组 → 候选 28 组（原先 6 组），塑料耗材 12、试剂盒 9、生物试剂 5、普通用品 2；MP 裂解介质管、ELISA 试剂盒、QuickExtract、MethoCult、MessengerMAX、8 联 PCR 管、生理盐水均在其中。

## 异名归一（TASK-67）

`apps/web/src/lib/stock-normalize.ts` 提供两张映射表和归一键，候选生成（入库前）和自动列关联（join 前）都先归一；不改 `material_items` 原始数据。

- 品牌别名表 `BRAND_ALIASES`（每组第一个为标准名，比较忽略大小写和空格，「Titan/泰坦」「诺唯赞（Vazyme）」这类组合写法拆开后任一部分命中即可）：
  - Thermo Fisher = Thermo = Thermo Fisher Scientific = 赛默飞 = Invitrogen = ABI = Applied Biosystems
  - 诺唯赞 = Vazyme = 南京诺唯赞
  - 泰坦 = Titan = 泰坦科技 = 探索平台
- 品目同义词表 `ITEM_SYNONYMS`（按顺序替换）：N孔板 = N孔细胞培养板 = N孔培养板 = N well plate；8联/8连/八连(排)(PCR)管 = 8连管；枪头 = 吸头。
- 脏写法：`货号:xxx 名称:xxx`（全/半角冒号均可）名称取「名称」字段，规格为空时用货号。
- 规格：`200T / 200 tests / 200Test / 200 T` 统一为 `200T`（不影响 T25、50 tubes、T2-PCR0200 等写法）。
- 归一键 = 归一名称 | 标准品牌 | 归一规格。
- **单位暂不归一**：支/盒/箱等混用时不换算；自动列只统计与库存条目同单位的采购行。单位归一策略待定。
- 扩充：在两张表里追加即可，需同步补 `stock-normalize.test.ts` 用例。

## 列与自动列（TASK-65）

列顺序：类别(大类/子类) ｜ 耗材名称 ｜ 品牌 ｜ 规格型号 ｜ 单位 ｜ 当前库存 ｜ 状态 ｜ 最近核对(时间+人) ｜ 参考消耗/月\* ｜ 最近采购\* ｜ 操作。

带 \* 两列由列表接口按归一键关联展示部门内非停用的 `material_items` 自动带出，无需人工填写：

- **参考消耗/月** = 同品采购数量（`coalesce(purchased_qty, quantity)`）合计 ÷ 首次到最近采购跨越的月数（含首尾月）；至少 2 笔采购才给出；库存条目填了单位时只统计同单位的采购行。例：1 月 4 箱、3 月 2 箱、6 月 6 箱 → 12 ÷ 6 = 2 箱/月。
  - 与方案稿「count/distinct 月份」的差异：按「有采购的月份数」相除会高估偶发采购的消耗，这里按跨越月数估算；如需改口径只改 `consumable-stock.ts` 的 `purchaseContext`。
- **最近采购** = 最近一笔的日期 + 数量 + 单位（不区分单位）。
- 无采购历史或未配置展示部门时两列为空，不报错。

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

## 状态口径（TASK-64：三态，不再使用安全库存）

| 状态 | 接口值 | 条件 | 说明 |
|---|---|---|---|
| 已用完 | `out` | 已核对且 `quantity <= 0` | 红色 |
| 需复核 | `stale` | 从未核对（`last_checked_at IS NULL`），或距最近核对超过 30 天 | 黄色；30 天为常量 `STOCK_STALE_DAYS` |
| 正常 | `ok` | 其余 | 绿色 |

- 从未核对的条目数量未知，不当作 0，归为「需复核」，当前库存列显示「—」、最近核对显示「尚未核对」。「从采购记录生成候选」新建的条目即属此类。
- 已核对且数量为 0 时，无论多久未核对都显示「已用完」。
- 不再出现「偏低 / 低于安全库存 / 未设」。`consumable_stock.safety_stock` 列保留不删（历史数据、库存校对流程不动），只是页面、接口返回和状态逻辑不再使用；新增/编辑请求里带 `safety_stock` 会被忽略。
- 列表 `status` 参数只接受 `out|stale|ok`；旧值 `unchecked|low` 返回 400「未知的库存状态」。

## 核对与并发

- 核对提交 `{ quantity, note, expected_revision }`；服务端在事务中锁定该行，比较 `revision`，不一致返回 409「库存刚刚被其他人更新，请刷新后重新核对」。
- 核对成功后 `revision + 1`、`last_checked_at = now()`、`last_checked_by = 当前用户`，并写入一条 `consumable_stock_checks`。
- 编辑只能改类别、名称、品牌、规格、单位、备注；传 `quantity` 会被拒绝，提示走「核对」；`safety_stock` 会被忽略。
- 删除会级联删除核对历史，并在审计日志写入条目快照（类别/名称/品牌/规格/数量）；有等待审批的库存校对请求时拒绝删除（409）。

## API

完整定义见 `api-contract.md`。示例：

```bash
# 列表（category 可为大类或「大类/子类」；status: out|stale|ok）
curl -b cookie.txt 'http://127.0.0.1:3000/api/v1/materials/stock?category=塑料耗材'

# 新增（管理员）
curl -b cookie.txt -H 'Content-Type: application/json' -X POST \
  -d '{"category":"塑料耗材/吸头","item_name":"200ul 滤芯吸头","brand":"示例品牌","spec_model":"EXAMPLE-TIP","unit":"盒","quantity":10}' \
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
2. 默认显示全部；点大类标签卡（普通用品/塑料耗材/生物试剂/试剂盒/其他）过滤，卡上 ⚠ 数字 = 已用完 + 需复核。顶部显示总数、已用完、需复核。类别列第一行是大类，下方灰色小标签是子类。
3. 管理员点「新增耗材」建立条目，类别下拉按大类分组选子类；初始库存留空表示未核对（显示需复核）。
4. 管理员点某行「核对」，填实际数量与备注（领用/报损/盘点说明），保存后列表刷新，点「历史」看台账。
5. 管理员点「从采购记录生成候选」，按类别关键词匹配展示部门内近 12 个月复购（≥2 笔）的启用记录，异名合并后只新增缺失条目，不修改已有库存。
6. 普通成员只能查看和看历史，没有新增/核对/编辑/删除/生成候选按钮。

成员或 agent 还可以提交「库存校对请求」，把一次盘点同时关联库存数量和采购记录，管理员在「物料审批 → 库存校对」批准后生效。接口与 agent 用法见 [`agent-mcp.md`](agent-mcp.md)。

## 迁移与部署

- 迁移文件：`db/migrations/011_consumable_stock.sql`（库存表）与 `db/migrations/012_stock_reconcile.sql`（库存校对请求）；迁移按文件名排序执行。
- 升级时执行 `node apps/web/scripts/migrate.mjs`（读取 `DATABASE_URL`），或在 Windows 安装包流程中自动执行。
- 新环境变量加到 `C:\lab-workspace\config\lab.env`；不配置 `MATERIAL_STOCK_CATEGORIES_JSON` 时使用内置四大类 + 其他（见「类别配置」）。
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

测试使用内存 PostgreSQL（PGlite）执行真实迁移和 SQL，覆盖：类别配置与大类标签卡、中英双语分类匹配与长尾排除、三态状态口径、异名归一（`stock-normalize.test.ts`）、参考消耗/月与最近采购、新增/编辑/删除、核对台账、revision 冲突、分类汇总、采购候选同步、库存校对提交/审批/过期 revision、成员/管理员权限、数据库异常不泄露内容。

## 明确不做

- 不自动按采购数量推算库存，不自动扣减。
- 不自动生成 OA 请购单或补货单；不设安全库存线，补货参考看「参考消耗/月」。
- 收货登记自动增补库存（TASK-69）暂不做：首期先人工盘点填数，台账跑顺后再按 material_code + 归一名称匹配、走库存校对审批通道。
- 不做库位、批次、效期、序列号；如后续需要，按 `material-inventory-research.md` 的升级路径另行评估。
- 不向普通成员开放直接改库存；成员/agent 只能提交待管理员批准的库存校对请求。
- 不自动创建耗材条目、不自动批准 agent 请求、不自动生成 OA 请购单。
- 不在页面或日志中展示真实部门、账号、采购明细。
