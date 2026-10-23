# 数据模型草案

## 核心表

### users

`id`, `username`, `display_name`, `password_hash`（bcrypt）, `role`, `freezer_view_all`（「冰箱总览」附加权限，默认关闭）, `is_active`, `failed_attempts`, `locked_until`, `created_at`, `updated_at`

### sessions

`id`（登录令牌的 SHA-256，Cookie 中才是原始令牌）, `user_id`, `expires_at`（7 天）, `created_at`

### guides

`id`, `owner_id -> users.id`, `name`, `target`, `sequence`, `pam`, `strand`, `target_position`, `bystander_position`, `target_base`, `edited_base`, `notes`, `created_at`, `updated_at`

`target_position` / `bystander_position` / `target_base` / `edited_base` 可选，分析页选 Guide 时用来回填参数；`bystander_position`（旁观位，迁移 006 新增）纳米孔与 Sanger 分析都会使用；须在序列范围内、不能与目标位置相同，且该位碱基须等于目标碱基（未填目标碱基时以目标位置上的碱基为准）——分析只在与目标碱基相同的位点计算编辑率，指到别的碱基只会得到空值。导入导出模板在末尾多一列「旁观位」，旧模板没有这一列也能导入（视为未填）。

约束：`owner_id + name` 唯一；序列统一大写并校验 IUPAC 字符；普通用户只能访问自己的记录。

### cell_inventory

字段按现有《细胞冻存登记表》（每个架子一个工作表，列为：层数、细胞名称、来源、代次、细胞密度、冻存液、管数、存放人、放入时间）设计：

`id`, `rack_no`（架号，1 起）, `layer_no`（层号 1–10）, `cell_name`, `source`, `passage`, `density`, `freezing_medium`, `tube_count`（整数，可空）, `tube_count_raw`, `depositor`（存放人，文字）, `frozen_on`（日期，可空）, `frozen_on_raw`, `needs_review`, `review_reason`, `remarks`, `import_batch_id`, `created_by`, `created_at`, `updated_at`

- 位置只记到架号 + 层号，不记孔位；按单个液氮罐设计。
- `*_raw` 保存导入时的原文。管数如「4/2/4管」、日期如 `20250307`、`202411` 等无法可靠转换的值保留原文、结构化字段置空，并置 `needs_review = true`；在系统内修正后清除标记。
- xlsx 导入按工作表名（如「1号架」）取架号；csv 导入需额外提供「架号」列，见 `examples/cell_inventory.example.csv`。
- 原表「层数」只写在每层第一行，导入时向下填充；整行为空或名称为空且其他列有内容的行进入错误/待核对列表。
- 取用即修改 `tube_count`；每次修改写入 `audit_logs`（`resource_type = cell`，`metadata_json` 记录变更字段的旧值/新值），用于在记录详情中展示修改历史。
- 登录用户可新增和修改；删除仅 admin，删除前把记录快照写入审计日志。
- `depositor` 为文字，不关联 `users`。

### material_items

字段按采购系统「请购物料库」导出（第 3 行为表头）设计，定位为采购记录查询，不是实物库存：

`id`, `requested_on`（请购日期）, `requester`（请购人）, `department`（任职部门）, `request_no`（采购单编码）, `material_code`（物料编码）, `status`（启用/停用）, `major_category`（请购大类）, `minor_category`（请购小类）, `item_name`, `brand`, `spec_model`（规格型号）, `unit`, `quantity`（请购数量）, `is_urgent`, `project_code`（使用项目）, `remarks`, `order_no`（合同或订单编号）, `purchased_qty`, `last_received_on`, `received_qty`, `receipt_status`, `import_batch_id`, `created_at`, `updated_at`, `is_used_up`, `used_up_at`, `used_up_by`, `used_up_requested_at`, `used_up_requested_by`

- 不含存放位置和剩余库存。
- 采购字段仅由管理员导入或本机任务增量更新，按「采购单编码＋物料编码」唯一组合匹配；事务失败保留旧数据，源文件缺失的旧记录不删除。
- 「停用」「未收货」记录照常导入，查询页提供状态筛选。
- 导入时去除首尾空格（如 ` CS-206`）。
- 一行代表一条采购记录，解析阶段不按名称或物料编码去重，同一物料多次采购全部保留。
- 普通成员可二次确认后提交已用完申请，批准前仍显示；管理员可批量批准或驳回、直接标记和恢复。标记按采购记录全员共享，不被 OA 同步覆盖。
- 后端保存全部部门，页面及审批查询只展示环境配置选定的部门，默认隐藏已用完记录，支持仅查看已用完。现有 10 个主展示列不增加。详见 `materials-update-plan.md`。

### consumable_stock / consumable_stock_checks（常用耗材库存）

与 `material_items` 分表保存的实物库存，迁移 `011_consumable_stock.sql`、`013_consumable_slots.sql`。2026-10-21 起一行 `consumable_stock` 是一个**固定规格槽位**（如「200µL 滤芯吸头」），不是采购记录，也不是具体品牌货号。

`consumable_stock`：`id`, `category`（配置中的类别名，「大类/子类」）, `item_name`, `brand`, `spec_model`, `unit`, `quantity`（当前数量，`numeric(12,2)`，≥0）, `safety_stock`（安全库存，≥0；2026-10-20 起停用，列保留不删，界面与状态逻辑不再读取）, `note`, `last_checked_at`（最近核对时间，空 = 从未核对）, `last_checked_by -> users.id`, `revision`（乐观锁版本）, `created_by`, `updated_by`, `created_at`, `updated_at`, `slot_key`（内置模板标识，唯一，手工槽位为空）, `baseline_at`（第一次核对 = 基线时间）；`(category, item_name, brand, spec_model)` 唯一。

`consumable_stock_checks`：`id`, `stock_id -> consumable_stock.id`（删除级联）, `before_qty`, `after_qty`, `note`, `checked_by -> users.id`, `checked_at`, `kind`（`check` 盘点 / `inbound` 入库）。每次盘点或入库追加一条，不覆盖历史。

`consumable_stock_skus`（货号记忆）：`id`, `identity_key`（名称|品牌|规格归一键，唯一）, `stock_id -> consumable_stock.id`（删除级联；为空 = 该货号已排除）, `item_name`, `brand`, `spec_model`, `created_by`, `created_at`。

`consumable_stock_links`（采购 → 槽位）：`material_id -> material_items.id`（主键，删除级联）, `stock_id -> consumable_stock.id`（删除置空）, `identity_key`, `state`（`pending` 待确认 / `confirmed` 已归入 / `stocked` 已入库 / `skipped` 不加数 / `excluded` 排除）, `confidence`（`known/high/mid/low`）, `applied_qty`, `decided_by -> users.id`, `decided_at`, `created_at`。

规则：

- 数量由「核对」（覆盖）和工作台「入库」（加数，仅基线后的已归入采购）改变；新增时可带初始数量（同时写一条「建立库存」并作为基线），不带则 `last_checked_at` 为空、页面显示「需复核」。
- 按采购单位整箱/整包计数，不拆箱换算。
- 状态三态：已核对且 `quantity <= 0` 为需采购（`out`）；从未核对或超过 30 天未核对为需复核（`stale`，从未核对的数量未知，不当作 0）；其余正常（`ok`）。
- 默认类别 = 槽位模板中的类别（细胞耗材/塑料耗材/通用耗材/培养基/常用试剂）+ 其他，可由 `MATERIAL_STOCK_CATEGORIES_JSON` 覆盖；采购归位由 `consumable-slots.ts` 规则给建议，管理员确认。
- 货号归一键沿用 `stock-normalize.ts`（品牌别名、品目同义词、规格写法），不改 `material_items` 原值。
- 查询和核对历史所有登录用户可看；新增/编辑/删除/核对/建模板/匹配/核对工作台仅 admin，与物料维护边界一致。
- 核对使用 `revision` 乐观锁，旧版本提交返回 409；建模板、匹配、确认/排除/入库/不加数、创建/修改/核对/删除均写 `audit_logs`，不写采购明细。
- 详见 `consumable-stock.md`，选型依据见 `material-inventory-research.md`。

### stock_reconcile_requests（库存校对请求）

成员或 agent 提交、管理员批准的库存校对，迁移 `012_stock_reconcile.sql`。一条请求可同时包含一个库存条目数量和若干采购记录。

`id`, `stock_id -> consumable_stock.id`（删除置空）, `stock_label`（提交时快照）, `stock_before`, `stock_revision`（提交时乐观锁版本）, `proposed_quantity`（可空 = 不改数量；0 = 用完）, `material_ids integer[]`（待标记为已用完的采购记录）, `note`, `status`（`pending`/`approved`/`rejected`）, `requested_by -> users.id`, `requested_at`, `reviewed_by -> users.id`, `reviewed_at`, `review_note`。

规则：

- 提交只写请求，不改库存和采购记录；`confirmed` 必须为 true，说明必填。
- 同一库存条目同时只允许一条待审批请求（部分唯一索引），避免两个数量提议互相覆盖。
- 管理员批准时在事务内锁定库存和请求：库存 revision 与提交时不一致返回 409，整批不生效；采购记录不存在同样 409。成功后更新库存、写 `consumable_stock_checks`、把采购记录设为 `is_used_up` 并清除待审批申请字段。
- 驳回只改请求状态；审计记录提交/批准/驳回，不写密码或采购明细。
- API 与 agent 用法见 `agent-mcp.md`。

### fixed_assets

`id`, `asset_code`（旧编号，如 ZX-…）, `asset_code_new`（新编号，如 CMC-…）, `asset_name`, `spec_model`, `category`, `quantity`, `location`, `department`, `user_name`, `import_batch_id`, `created_at`

- **全量入库**：读取所有含「固定资产名称」「使用部门」表头的工作表，跳过名为 `SheetN` 的草稿/旧版工作表（其内容与正式表重复）；台账里**所有部门**的行都写入，页面能看哪些部门由查询时的部门配置决定（见 `api-contract.md`）。
- 跳过台账中重复出现的表头行（旧版块会再写一次表头）与「合计」行，跳过缺少使用部门的行；跳过原因在导入预览里按工作表＋行号列出。
- 两套编号都随行保留，展示优先用新编号；编号同时作为跨表去重依据（没有编号时退回整行比较）。
- 全员只读，管理员整表替换；台账条目增减不需要改代码，重新导入即可。
- 页面默认按「资产名称＋规格型号＋使用部门」汇总：同名同规格、不同存放地点的资产只占一行，展开后按地点列出各自的资产编号。

### freezers / freezer_containers / freezer_samples（冰箱管理）

结构为「冰箱 → 容器 → 样品」，样品只定位到容器，不记孔位。界面上容器统称「盒子/框」。带架子的冰箱（-80℃）另有「冰箱层 → 架子 → 架内层 × 盒位」的布局（迁移 `008_freezer_racks.sql`）。

- `freezers`：`id`, `name`（唯一）, `temperature`（`-80` / `-20` / `4`）, `location`, `remarks`, `is_active`, `shelf_count`（总层数，选填）, `racks_per_shelf`（每层架位数，选填）, `created_at`, `updated_at`。仅管理员维护；停用后不能再新建容器，已有记录不受影响；有容器或架子的冰箱不能删除。`shelf_count` 与 `racks_per_shelf` 同时填写时显示布局图；缩小或取消布局时不能有架子/容器落在布局之外。
- `freezer_racks`：`id`, `freezer_id`, `shelf_no`, `position`（该层第几个架位，即容器的 `rack_no`）, `owner_id -> users.id`（分配给谁，可空 = 未分配）, `tiers`（架内层数，默认 5）, `depth`（每层盒位数，默认 4）, `remarks`, `created_at`, `updated_at`；`(freezer_id, shelf_no, position)` 唯一。仅管理员放置、分配、改规格、移除；架子上还有容器时不能移除，缩小规格时不能有盒子落在外面。改分配不移动已有盒子。
- `freezer_containers`：`id`, `owner_id -> users.id`, `freezer_id`, `kind`（`box` 盒子 / `basket` 框）, `name`, `shelf_no`（层，必填）, `rack_no`（架，选填）, `slot_no`（架内格位，选填，无布局冰箱用）, `tier_no` / `depth_no`（架内第几层、该层第几个盒位，选填，须同时填写且只用于盒子；同一格位唯一）, `is_shared`（公共，仅管理员可设）, `remarks`, `created_at`, `updated_at`。只登记了架号、没有格位的盒子在布局图上显示为「待归位」。不设盒子规格；大箱子或框不填架号、格位。盒子在同一「冰箱/层/架/格」已有其他盒子时只提示，不阻止保存，提示不透露对方信息。只能删除没有在库样品的容器。
- `freezer_samples`：`id`, `owner_id`, `container_id`（可空）, `name`（样品信息）, `project_no`, `sample_type`, `remarks`, `status`（`stored` / `removed`）, `stored_on`, `removed_at`, `created_at`, `updated_at`。一条 = 一管；在库样品必须有容器；容器删除后其中已取出样品的 `container_id` 置空。

规则：

- 容器和样品归创建人。普通用户只能查看和操作自己的（公共容器除外）；管理员，以及在账号管理中开启了「冰箱总览」（`users.freezer_view_all`）的成员，另有只读的「全部人员」视图（可按存放人筛选），不能修改他人数据。「冰箱总览」不带来任何其他管理权限，开关即时生效。
- 架子：往已登记架子的位置放盒子（新建或搬入）时，该架子必须分配给本人；未分配的架子谁都不能放。原地修改（不搬位置）不检查分配。
- 公共容器（如 -80℃ 最下层的公共框）：所有人都能看到其中全部样品并往里存入；每管样品仍只有存放人能取出、转移、修改和删除；流转记录所有人可看。只有管理员能设置/修改公共容器；里面还有任何人的在库样品时不能删除。
- 批量存入：一次最多 500 管存到同一容器（自己的或公共的），可在同一事务里新建容器。
- 批量取出 / 转移：取出只改状态、保留记录；转移到已有或新建容器；已取出的样品转入容器即放回。
- 流转历史写入 `audit_logs`（`resource_type = freezer_sample`），`metadata_json` 记录原位置、新位置（当时的位置文字）和用途说明；修改记录旧值/新值；删除录错记录前写快照。容器搬位置记在容器自身的审计日志里。

### feedback_threads / feedback_posts / feedback_reads（留言板）

成员向管理员反馈问题（类似 issue），迁移 `007_feedback.sql`。

- `feedback_threads`：`id`, `author_id -> users.id`, `title`（≤100 字）, `status`（`open` 待处理 / `closed` 已解决）, `last_post_at`, `created_at`, `updated_at`。
- `feedback_posts`：`id`, `thread_id`, `author_id`（账号删除后置空）, `body`（≤5000 字）, `created_at`；第一条是发起时的正文。
- `feedback_reads`：`(user_id, thread_id)` 主键，`read_at`：最后一次打开的时间。

规则：成员只能看到、回复自己发起的留言；管理员看全部、可回复、可标记已解决/重新打开。未读 = 有别人发的、晚于自己 `read_at` 的帖子，导航栏「留言板」显示未读条数；打开即已读。不推送、不通知。审计日志只记标题和状态变化，不记正文。

### import_batches

`id`, `dataset_type`（cells/materials/assets）, `filename`, `row_count`, `accepted_count`, `rejected_count`, `review_count`, `created_by`, `created_at`, `status`, `error_summary`（问题行的工作表、行号、原因）

仅保存导入元数据和错误摘要，不保存用户上传的原始工作簿。

### analysis_jobs

`id`（分析服务的临时会话号）, `user_id`, `kind`（sanger/nanopore）, `status`（uploaded/queued/running/analyzed/failed/deleted）, `n_units`（文件或样本数，用于估算排队时长）, `error_summary`, `created_at`, `updated_at`

只记录归属与状态，不存序列、文件或结果。

### audit_logs

`id`, `actor_id`, `action`, `resource_type`, `resource_id`, `metadata_json`, `ip_hash`, `created_at`

`metadata_json` 禁止写入序列、密码、原始文件内容和敏感样本信息。

结构定义见 `db/migrations/`。
### 标签打印可见性：users.label_print_enabled（TASK-87，2026-10-23 调整）

标签打印改为**账号级开关** `users.label_print_enabled`，与 `freezer_view_all` 同一模型：管理员在「账号管理」勾选或关闭，入口与接口只按该账号判断，不影响登录。

`tenants` 与 `users.tenant_id` 保留作预留（`tenant_id` 允许为空），不再参与登录校验或任何功能授权。原先用租户开关门禁登录，管理员停用默认租户后自己也无法登录，该做法已废弃。

### label_printers / label_print_jobs（TASK-87）

`label_printers` 是全局打印机目录，保存工作台显示名、传给本机标签服务的 `printer_key`、启用状态和默认标记。`label_print_jobs` 记录请求编号、用户、设备、模板、字段、行数和送出状态，用唯一 `request_id` 防止重复提交；不保存标签原始内容。`template` 存 `来源:模板`（如 `materials:name-only`），便于回溯当时的数据来源与版式。

标签打印的数据来源与字段白名单在 `apps/web/src/lib/label-sources.ts` 一处声明（部门物料、冰箱在库样品、固定资产），页面表格、接口校验和标签行生成都由它派生；新增来源只需补一段取数 SQL。
