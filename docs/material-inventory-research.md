# 部门物料采购周期调研与开源库存方案评估

- 日期：2026-10-20
- 关联任务：TASK-57（调研）、TASK-56（常用耗材库存）
- 范围：lab-workspace 的「部门物料」采购记录、OA 周同步，以及 GitHub 上可参考的开源库存项目
- 结论用途：为 TASK-56 的库存模型和后续采购/补货功能提供依据

## 0. 结论摘要

1. **采购习惯目前只能从系统记录间接还原，具体周期数值尚未实测。** 系统已确认「每周六 03:00 从 OA 导出并增量入库」这一节奏，但现有字段只有请购日期和「最近收货日期」，没有每次收货时间、审批时间和实际消耗，无法精确计算单笔采购的交期，也无法算库存周转。需要生产库只读数据或部门访谈补齐（见第 3 节）。
2. **GitHub 上没有可直接嵌入本项目的成熟方案。** InvenTree 功能最完整（MIT、PostgreSQL、盘点/最低库存/REST API），但它是 Django 多进程系统，官方以 Docker 部署为主；Part-DB 较轻但偏电子元件且为 AGPL；Grocy 只有 SQLite 且定位家庭；Snipe-IT 是资产台账而非数量库存；OpenBoxes 面向医疗仓储，过重。考虑 windows-wg 为 Windows 10 LTSC、8 GB 内存、不使用 Docker，且已有 PostgreSQL + Next.js + 账号体系，**不建议另起一套库存系统**。
3. **推荐在本项目内做小模块（已在 TASK-56 实现）**：配置化耗材类别、按类别汇总、当前库存/安全库存、核对台账（改前/改后/操作人/备注）、待核对/已用完/偏低/待复核状态、管理员核对与编辑、从采购记录生成候选。设计上借用 InvenTree 的「盘点快照/历史」、Part-DB 的 `minamount`、Grocy 的 `min_stock_amount` 语义，不引入其技术栈。
4. **采购周期调研的下一步**：用第 3.2 节的 SQL 在生产库跑一次分类统计，再用第 3.3 节的四周盘点表校准消耗速度和安全库存；两项都完成前，不要把「缺货/偏低」直接当成采购建议，也不要自动生成 OA 请购单。

## 1. 已核实的采购流程与数据基础

以下内容来自仓库内的代码与文档，不包含生产库真实数值：

- **OA 导出**：独立程序登录 OA「采购管理 → 部门物料」报表，在两层 iframe 内点击导出；用临时浏览器，不保存 cookie。已部署为每周六服务器时间 03:00（UTC+8）的计划任务，失败不自动重试。见 `docs/oa-material-export.md`。
- **增量入库**：按「采购单编码 + 物料编码」匹配；新记录插入，旧记录只更新 OA 业务字段，保留本地已用完标记、申请人/审批人和时间；源文件暂时缺失的旧记录不删除；整次导入在事务中完成。见 `apps/web/src/lib/materials-data.ts` 与 `docs/materials-update-plan.md`。
- **展示范围**：全部部门都入库，网页只展示 `MATERIAL_DISPLAY_DEPARTMENTS_JSON` 配置的部门；列表、总数、分页、候选和审批都受同一范围限制。未配置时展示空列表，不默认展示全部。
- **本地状态**：普通成员可二次确认后提交「已用完」申请，管理员批准/驳回/直接标记/恢复；标记按单条采购记录、全员共享，不被 OA 同步覆盖。
- **记录粒度**：一行 = 一条采购记录，同一物料多次采购全部保留；没有按物料合并的「库存」概念（TASK-56 新增的 `consumable_stock` 是独立表）。
- **字段限制**：采购表有 `requested_on`、`last_received_on`、`quantity`、`purchased_qty`、`received_qty`、`receipt_status`、`is_urgent` 等，但没有「首次收货日期」、每次收货流水、审批时间、领用记录、存放位置和效期。`last_received_on` 是最近一次收货日期，不是单笔订单的到货时间。
- **同步延迟**：OA 每周同步一次，网页上的采购字段最多滞后约 7 天；本地标记和核对不受同步影响。

### 1.1 现有数据能算什么、不能算什么

| 指标 | 可用字段/口径 | 限制 |
|---|---|---|
| 请购频次、相邻两次请购间隔 | 按「部门 + 名称 + 品牌 + 规格」分组，对 `requested_on` 做 `lag()` | 同一物料不同采购单会混在一起；名称/规格写法不一致会拆成多组 |
| 请购到最近收货的天数 | `last_received_on - requested_on` | 多次收货时是「请购→最后一次收货」，会高估交期；未收货/日期缺失需排除 |
| 紧急采购比例 | `is_urgent` | 只反映 OA 勾选，不反映口头催货 |
| 收货完整度 | `receipt_status`、`received_qty / purchased_qty` | 部分收货、拆分到货的真实过程看不到 |
| 部门/小类采购结构 | `department`、`major_category`、`minor_category` | 小类由 OA 维护，可能随年份调整 |
| 年度请购量 | `sum(quantity)` 或 `purchased_qty` | 数量单位不统一（盒/箱/瓶/包），不能跨物料直接相加 |
| 实际消耗速度、库存周转 | — | 没有领用记录和期初/期末库存，**算不出** |
| 单笔订单交期、审批时长、缺货时长 | — | 没有首次收货、审批、缺货事件时间，**算不出** |

### 1.2 对库存功能的直接含义

- 库存数量不能由采购数量自动推算。采购记录只能提供「买过什么」，不能证明「现在还剩多少」；必须有人工核对。
- 「未核对」不能当成 0。TASK-56 因此把从未核对过的条目标为「待核对」，不显示为缺货，也不计入缺货数。
- 安全库存需要「消耗速度 × 交期」两类数据；当前两者都不完整。第一版先允许管理员手工设置安全库存，等四周盘点数据出来后再校准。
- 采购记录与库存条目分开保存，OA 增量同步不会覆盖核对结果；这避免了「同步把库存改回采购数量」的错误。

## 2. 采购周期指标的取数方法

在具备生产库只读权限时执行。以下 SQL 只读，不修改数据；真实部门名和数值不要写进仓库。

### 2.1 按小类看请购节奏与近似交期

```sql
WITH base AS (
  SELECT department, minor_category, item_name, brand, spec_model, unit, requested_on,
         last_received_on, receipt_status, is_urgent,
         requested_on - lag(requested_on) OVER (
           PARTITION BY department, item_name, brand, spec_model ORDER BY requested_on
         ) AS interval_days
  FROM material_items
  WHERE status <> '停用'
    AND requested_on IS NOT NULL
    AND department = ANY(ARRAY['<展示部门甲>', '<展示部门乙>'])
)
SELECT minor_category,
       count(*) AS purchase_lines,
       count(DISTINCT (item_name, brand, spec_model)) AS item_count,
       round(avg(interval_days) FILTER (WHERE interval_days IS NOT NULL), 1) AS avg_interval_days,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY interval_days)
         FILTER (WHERE interval_days IS NOT NULL) AS median_interval_days,
       round(avg(last_received_on - requested_on)
         FILTER (WHERE last_received_on IS NOT NULL AND receipt_status <> '未收货'), 1) AS avg_request_to_last_receipt_days,
       round(100.0 * count(*) FILTER (WHERE is_urgent) / count(*), 1) AS urgent_pct
FROM base
GROUP BY minor_category
ORDER BY purchase_lines DESC;
```

### 2.2 找高频、短周期、常紧急的耗材

```sql
WITH base AS (
  SELECT department, item_name, brand, spec_model, unit, requested_on, last_received_on, receipt_status, is_urgent,
         requested_on - lag(requested_on) OVER (
           PARTITION BY department, item_name, brand, spec_model ORDER BY requested_on
         ) AS interval_days
  FROM material_items
  WHERE status <> '停用' AND requested_on IS NOT NULL
    AND department = ANY(ARRAY['<展示部门甲>', '<展示部门乙>'])
)
SELECT item_name, brand, spec_model, unit,
       count(*) AS times,
       min(requested_on) AS first_on,
       max(requested_on) AS last_on,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY interval_days)
         FILTER (WHERE interval_days IS NOT NULL) AS median_gap_days,
       round(avg(last_received_on - requested_on)
         FILTER (WHERE last_received_on IS NOT NULL AND receipt_status <> '未收货'), 1) AS approx_lead_days,
       round(100.0 * count(*) FILTER (WHERE is_urgent) / count(*), 1) AS urgent_pct
FROM base
GROUP BY item_name, brand, spec_model, unit
HAVING count(*) >= 2
ORDER BY times DESC, median_gap_days ASC NULLS LAST
LIMIT 50;
```

**解读注意**：

- 先按名称/品牌/规格人工合并同物异名，否则间隔会被拆散。
- `approx_lead_days` 是近似值；只有一条收货记录的物料才接近真实交期。
- 紧急比例高但采购次数不多的物料，可能是一次性事件，不宜直接设高安全库存。
- 结果只用于排序和访谈提纲，不直接写进代码或文档。

## 3. 仍需人工确认的问题

### 3.1 访谈提纲（采购/细胞房负责人）

1. 请购、审批、下单、到货分别由谁负责？是否有固定预算周期或集中采购日？
2. 从提交请购到到货，国产耗材、进口耗材、培养基/血清各大概多久？最短/最长是多少？
3. 现在有没有约定俗成的最低库存或「看到快没了再买」的规则？由谁判断？
4. 细胞房耗材放在哪里？是否按部门、课题组或个人分开？是否需要按存放位置盘点？
5. 一周/一月大概消耗多少？实验高峰期和平时差多少？
6. 缺货时怎么办（紧急采购、互相借、换品牌）？最近半年发生过几次？
7. 培养基、血清等是否需要批次、效期、开封日期管理？过期怎么处理？
8. 现在多久盘一次点？谁盘？盘点和账面不一致时怎么处理？
9. 希望普通成员能直接改库存，还是只让管理员改、成员提交核对申请？
10. 库存是否需要和具体采购单/采购批次关联？还是只按物料汇总即可？

### 3.2 四周盘点模板（校准消耗速度）

每周固定同一天、同一时间盘一次，连续 4 周。只记录目标耗材，避免工作量过大。

| 日期 | 类别 | 耗材（名称/品牌/规格） | 单位 | 期初库存 | 本周入库 | 期末库存 | 本周消耗 | 缺货天数 | 备注 |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| 第 1 周 | 吸头 | 示例 200ul 滤芯吸头 | 盒 |  |  |  |  |  |  |
| 第 2 周 | 吸头 | 示例 200ul 滤芯吸头 | 盒 |  |  |  |  |  |  |

- 本周消耗 = 期初库存 + 本周入库 − 期末库存。
- 连续 4 周取平均得到周消耗 `W`；日消耗 `d = W / 7`。
- 若暂时没有交期数据，安全库存的起步规则可用「2 周消耗」；有交期 `L` 天和日消耗波动 `σ_d` 后，再改为 `安全库存 = z × σ_d × √L`（95% 服务水平约 `z = 1.65`），补货点 = `d × L + 安全库存`。
- 这只是统计起步值，最终由部门确认；系统里先手工填安全库存，不自动下单。

### 3.3 还需要补的系统能力（不在本次范围）

- 每次收货的时间和数量流水（用于真实交期）。
- 领用/消耗登记（用于自动扣减和周转率）。
- 批次/效期/开封日期（培养基、血清）。
- 按存放位置或部门分库存。
- 低库存自动生成 OA 请购草稿。

以上都需要先确认业务规则，避免用采购记录猜库存。

## 4. GitHub 开源库存项目评估

查询时间：2026-10-20；数据来自 GitHub API（星数、许可、最近发布）和仓库文档。功能判断以官方文档/代码为准，未在本机实际部署这些项目。

### 4.1 候选与硬指标

| 项目 | Stars | 许可 | 技术栈/数据库 | 最近发布 | 部署形态 |
|---|---:|---|---|---|---|
| [InvenTree](https://github.com/InvenTree/InvenTree) | 7,736 | MIT | Python/Django；PostgreSQL（也支持 SQLite/MySQL） | 1.6.0（2026-10-18） | Docker Compose 为主，含 web/worker/db/redis；原生安装可行但组件多 |
| [Part-DB](https://github.com/Part-DB/Part-DB-server) | 1,805 | AGPL-3.0 | PHP 8.2+/Symfony；PostgreSQL/MySQL/SQLite | v2.20.2（2026-10-18） | PHP Web 应用，Docker 或传统 LAMP |
| [Grocy](https://github.com/grocy/grocy) | 9,601 | MIT | PHP 8.5；仅 SQLite | v4.7.1（2026-09-04） | PHP 内置服务器/Docker；有 Windows 桌面版 |
| [Snipe-IT](https://github.com/grokability/snipe-it) | 15,052 | AGPL-3.0 | PHP/Laravel；MySQL/MariaDB | v8.8.1（2026-10-20） | LAMP/Docker；资产台账 |
| [OpenBoxes](https://github.com/openboxes/openboxes) | 915 | EPL-1.0 | Groovy/Grails；MySQL | v0.9.8-hotfix1（2026-08-14） | Java 应用 + MySQL，偏医疗仓储 |
| [HomeBox](https://github.com/sysadminsmedia/homebox) | 7,585 | AGPL-3.0 | Go；SQLite 单文件 | v0.27.0（2026-10-17） | 单二进制，资源占用低 |
| [django-lab-inventory](https://github.com/melizalab/django-lab-inventory) | 51 | BSD-3-Clause | Python/Django；PostgreSQL/SQLite | PyPI 包，持续维护 | Django 应用，实验室自用 |
| [Inventarium](https://github.com/1966bc/inventarium) | 25 | 以仓库为准 | Python/Tkinter；SQLite | 2026-09 仍在更新 | 桌面单机，非 Web/多用户 |

### 4.2 与本项目需求的匹配

需求关键词：类别汇总、当前数量、最低/安全库存、人工核对历史、多用户权限、审计、API、可在无 Docker 的 Windows 主机部署、与现有 PostgreSQL/账号体系共存。

| 项目 | 类别/条目 | 数量与最低库存 | 盘点/历史 | 位置/批次/效期 | 权限/API | 适配判断 |
|---|---|---|---|---|---|---|
| InvenTree | 类别树 + Part + Stock Item | `minimum_stock`/`maximum_stock`，低库存提示 | Part Stocktake 快照、历史图表、CSV 报告 | 位置、批次、效期、序列号 | 角色权限、REST API | 功能最全，**作为设计参考**；部署过重 |
| Part-DB | 类别树 + Part + Lot | `minamount`，低库存 | 库存/批次变更；有审计/日志能力（以文档为准） | 存放位置、批次、制造商 | 用户/组权限、REST API（`/api/docs.json`） | 轻量备选；偏电子元件，AGPL |
| Grocy | 产品分组 | `min_stock_amount`，低于最低库存可自动加入购物清单 | 库存记录、到期日 | 位置、到期日、批次 | 用户权限、REST API | 补货语义参考；SQLite、家庭定位 |
| Snipe-IT | 资产类别 | 消耗品有数量/签出，但无最低库存与盘点 | 签出/归还历史 | 位置、资产标签 | 角色权限、REST API | 资产台账，**不适配数量库存** |
| OpenBoxes | 仓库/库位/品类 | 库存移动、批次/效期、补货 | 库存流水 | 仓库、库位、批次、效期 | 角色权限、API | 医疗供应链，**过重** |
| HomeBox | 类别/位置/标签 | 有数量字段，无最低库存/盘点 | 维护/购买记录 | 位置、标签、自定义字段 | 多用户、API | 实体模型参考；不满足盘点/最低库存 |
| django-lab-inventory | Item/Order/Vendor | 订单与条目，库存能力有限 | 订单历史 | 位置（基础） | Django 权限 | 实验室「采购 vs 条目」分离的参考 |

### 4.3 逐项评价

**InvenTree（最值得借鉴）**

- 优点：MIT；PostgreSQL；Part 与 Stock Item 分离，支持库位、批次、效期、序列号；`minimum_stock`/`maximum_stock`；Part Stocktake 记录历史库存快照并生成报告；REST API 完整；社区活跃（7.7k stars，1.6.0 于 2026-10-18 发布）。
- 不适合直接部署：Django + 后台 worker + Redis + 数据库，官方以 Docker 为主；windows-wg 为 Windows 10 LTSC、8 GB 内存、明确不用 Docker；需要额外的账号、备份、升级和监控；与现有物料/账号形成两套数据源。
- 可借鉴：**盘点快照（stocktake）而不是只存一个当前值**；最低/最高库存；Part 与实物库存分离（对应我们的「采购记录 vs 库存条目」）。

**Part-DB（轻量备选）**

- 优点：PHP 部署简单，支持 PostgreSQL；类别树、Part、Lot、存放位置、`minamount`、REST API；2.20.2 于 2026-10-18 发布。
- 限制：面向电子元件（封装、制造商、订购编号），实验室耗材的类别/单位/盘点语义需要较多改造；AGPL-3.0，内部使用通常没问题，但修改后再分发有义务；仍需独立的 PHP + 数据库栈。
- 可借鉴：`minamount` 的「低于阈值」判定、类别树、批次/位置模型。

**Grocy（补货语义参考）**

- 优点：MIT；极轻（PHP + SQLite，甚至有 Windows 桌面版）；产品数量、`min_stock_amount`、到期日、购物清单、REST API；低于最低库存可自动加入购物清单。
- 限制：SQLite 单库、家庭/食品定位；没有实验室类别、审计和部门权限模型；不适合作为部门共用系统。
- 可借鉴：`min_stock_amount` + 「低于阈值 → 补货清单」的产品语义；我们只做低库存提示，不自动生成 OA 单。

**Snipe-IT / OpenBoxes / HomeBox / django-lab-inventory**

- Snipe-IT：强在资产、许可证、签出归还；消耗品只是附属，缺最低库存和盘点，不能解决「现在还剩多少」。
- OpenBoxes：真正的仓储系统（批次、效期、调拨、请购），但 Groovy/Grails + MySQL、面向医疗机构，部署和培训成本远超本需求。
- HomeBox：Go 单二进制 + SQLite，类别/位置/标签/数量/自定义字段，适合参考「条目 + 位置」的轻量模型；没有最低库存、盘点历史和审计。
- django-lab-inventory：最贴近「实验室买过什么、放在哪」的小项目，但库存数量和盘点能力弱、社区小；适合参考 Item/Order 分离。

### 4.4 选型建议

**不自建部署上述任何一套系统，按 TASK-56 在 lab-workspace 内实现最小库存模块。** 理由：

1. **部署约束**：windows-wg 原生 Windows、无 Docker、8 GB 内存，已经运行 Node/PostgreSQL/R；再引入 Django/PHP/Java 栈和 worker/Redis 成本高。
2. **账号与权限**：现有用户、角色、审计、部门展示范围已经就绪；外部系统需要重复建账号或做 SSO，且权限模型不一致。
3. **数据源唯一性**：采购记录已在 PostgreSQL；库存若放在外部系统，会出现两套物料主数据和两套备份。
4. **功能边界**：本需求只要「按类别汇总 + 数量 + 安全库存 + 核对历史 + API」，不需要库位、批次、BOM、供应商、采购单审批；InvenTree/OpenBoxes 的大部分能力用不上。
5. **可逆性**：先做小模块，若未来确实需要库位/批次/效期，再评估 InvenTree；届时也可以只迁移库存表，不迁移采购记录。

**保留的升级路径**：若出现以下任一情况，再重新评估 InvenTree：

- 需要按库位/冰箱/柜子管理到具体位置；
- 需要批次、效期、序列号和 FEFO；
- 需要 BOM、供应商、采购单审批、多仓库调拨；
- 部署环境允许 Docker，且有人力维护独立系统。

## 5. 对 TASK-56 实现的映射

| 调研结论 | TASK-56 的实现 |
|---|---|
| 类别要可配置，不写死五个 | `MATERIAL_STOCK_CATEGORIES_JSON`，默认吸头/细胞培养板/移液管/离心管/培养基，可改名称和关键词 |
| 采购记录不能当库存 | 新增 `consumable_stock`，与 `material_items` 分表；OA 同步不触碰库存 |
| 未核对 ≠ 0 | `last_checked_at IS NULL` 显示「待核对」，不计入已用完/偏低 |
| 需要盘点历史 | `consumable_stock_checks` 保存改前/改后/操作人/备注/时间 |
| 需要最低库存 | `safety_stock`；`quantity <= safety_stock` 标「偏低」，`quantity <= 0` 标「已用完（缺货）」 |
| 需要防止并发覆盖 | `revision` 乐观锁；核对时带 `expected_revision`，冲突返回 409 |
| 需要审计 | `audit_logs` 记录 create/update/check/delete/sync，不写采购明细 |
| 需要从现有数据起步 | 「从采购记录生成候选」按关键词匹配展示部门内启用记录，只新增缺失条目，数量为待核对 |
| 需要 API 人工修正 | `GET/POST /api/v1/materials/stock`、`PATCH/DELETE /:id`、`POST /:id/check`、`GET /:id/checks`、`POST /sync` |
| 权限边界 | 查询和核对历史：登录用户；新增/编辑/删除/核对/生成候选：管理员（与现有物料维护边界一致） |
| agent 对话校对 | `apps/mcp-server` 暴露检索/提交/状态三个 MCP 工具；提交只生成待审批的 `stock_reconcile_requests`，管理员批准后事务内同时改库存和采购标记（2026-10-20 增补） |

## 6. 参考链接

- InvenTree 仓库：https://github.com/InvenTree/InvenTree
- InvenTree Part Stocktake 文档：https://docs.inventree.org/en/latest/part/stocktake/
- InvenTree API 文档：https://docs.inventree.org/en/latest/api/
- Part-DB 仓库：https://github.com/Part-DB/Part-DB-server
- Part-DB 文档：https://docs.part-db.de/
- Grocy 仓库：https://github.com/grocy/grocy
- Grocy 官网：https://grocy.info
- Snipe-IT 仓库：https://github.com/grokability/snipe-it
- OpenBoxes 仓库：https://github.com/openboxes/openboxes
- HomeBox 仓库：https://github.com/sysadminsmedia/homebox
- django-lab-inventory：https://github.com/melizalab/django-lab-inventory
- Inventarium：https://github.com/1966bc/inventarium
- 本仓库 OA 导出说明：`docs/oa-material-export.md`
- 本仓库物料增量与审批：`docs/materials-update-plan.md`

## 7. 未测与限制

- **采购周期具体数值未测**：没有生产库访问权限，也没有对部门进行访谈；第 2 节的 SQL 和第 3 节的模板是可直接执行的取数方案，结果需由部门确认后补入本文件。
- **开源项目未实际部署**：星数、许可、发布时间来自 GitHub API；功能判断来自官方文档/代码，不代表已在 windows-wg 上跑通。Windows 原生部署、内存占用、升级路径需要另做 PoC。
- **InvenTree 的数据库支持**以官方文档为准；本文件未逐一验证 SQLite/MySQL 组合。
- **安全库存公式**是统计起步值，不是部门确认的业务规则；首版只提供手工设置，不自动补货。
- 真实部门名、账号、采购数值不得写入本文件或代码；示例均为虚构。
