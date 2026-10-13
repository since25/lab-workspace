# 数据模型草案

## 核心表

### users

`id`, `username`, `display_name`, `password_hash`（bcrypt）, `role`, `freezer_view_all`（「冰箱总览」附加权限，默认关闭）, `is_active`, `failed_attempts`, `locked_until`, `created_at`, `updated_at`

### sessions

`id`（登录令牌的 SHA-256，Cookie 中才是原始令牌）, `user_id`, `expires_at`（7 天）, `created_at`

### guides

`id`, `owner_id -> users.id`, `name`, `target`, `sequence`, `pam`, `strand`, `target_position`, `target_base`, `edited_base`, `notes`, `created_at`, `updated_at`

`target_position` / `target_base` / `edited_base` 可选，分析页选 Guide 时用来回填参数。

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

`id`, `requested_on`（请购日期）, `requester`（请购人）, `department`（任职部门）, `request_no`（采购单编码）, `material_code`（物料编码）, `status`（启用/停用）, `major_category`（请购大类）, `minor_category`（请购小类）, `item_name`, `brand`, `spec_model`（规格型号）, `unit`, `quantity`（请购数量）, `is_urgent`, `project_code`（使用项目）, `remarks`, `order_no`（合同或订单编号）, `purchased_qty`, `last_received_on`, `received_qty`, `receipt_status`, `import_batch_id`, `created_at`

- 不含存放位置和剩余库存。
- 普通用户只读；admin 上传新导出文件后在一个事务内整表替换，导入失败时保留旧数据。
- 「停用」「未收货」记录照常导入，查询页提供状态筛选。
- 导入时去除首尾空格（如 ` CS-206`）。

### fixed_assets

`id`, `asset_name`, `spec_model`, `category`, `quantity`, `location`, `department`, `user_name`, `import_batch_id`, `created_at`

- 来源《固定资产台账》：读取所有含「固定资产名称」「使用部门」表头的工作表，跳过名为 `SheetN` 的草稿/旧版工作表（其内容与正式表重复）；只导入使用部门为研发部的行。
- 资产编号只用于跨表去重，不入库；全员只读，管理员整表替换。

### freezers / freezer_containers / freezer_samples（冰箱管理）

结构为「冰箱 → 容器 → 样品」，样品只定位到容器，不记孔位。

- `freezers`：`id`, `name`（唯一）, `temperature`（`-80` / `-20` / `4`）, `location`, `remarks`, `is_active`, `created_at`, `updated_at`。仅管理员维护；停用后不能再新建容器，已有记录不受影响；有容器的冰箱不能删除。
- `freezer_containers`：`id`, `owner_id -> users.id`, `freezer_id`, `kind`（`box` 盒子 / `basket` 框）, `name`, `shelf_no`（层，必填）, `rack_no`（架，选填）, `slot_no`（架内格位，选填）, `remarks`, `created_at`, `updated_at`。不设盒子规格；大箱子或框不填架号、格位。盒子在同一「冰箱/层/架/格」已有其他盒子时只提示，不阻止保存，提示不透露对方信息。只能删除没有在库样品的容器。
- `freezer_samples`：`id`, `owner_id`, `container_id`（可空）, `name`（样品信息）, `project_no`, `sample_type`, `remarks`, `status`（`stored` / `removed`）, `stored_on`, `removed_at`, `created_at`, `updated_at`。一条 = 一管；在库样品必须有容器；容器删除后其中已取出样品的 `container_id` 置空。

规则：

- 容器和样品归创建人。普通用户只能查看和操作自己的；管理员，以及在账号管理中开启了「冰箱总览」（`users.freezer_view_all`）的成员，另有只读的「全部人员」视图（可按存放人筛选），不能修改他人数据。「冰箱总览」不带来任何其他管理权限，开关即时生效。
- 批量存入：一次最多 500 管存到同一容器，可在同一事务里新建容器。
- 批量取出 / 转移：取出只改状态、保留记录；转移到已有或新建容器；已取出的样品转入容器即放回。
- 流转历史写入 `audit_logs`（`resource_type = freezer_sample`），`metadata_json` 记录原位置、新位置（当时的位置文字）和用途说明；修改记录旧值/新值；删除录错记录前写快照。容器搬位置记在容器自身的审计日志里。

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
