# V1 API 草案

所有接口前缀为 `/api/v1`，除登录接口外需要有效会话。

## 认证

- `POST /auth/login`：用户名/密码登录（连续失败 5 次锁定 15 分钟）
- `POST /auth/logout`：注销
- `GET /auth/me`：当前用户
- `PATCH /auth/password`：修改自己的密码
- `GET /health`：健康检查（无需登录，只返回数据库与分析服务是否可用）

## Guide

- `GET /guides`
- `POST /guides`
- `PATCH /guides/:id`
- `DELETE /guides/:id`
- `GET /guides/export`：导出 CSV；`?template=1` 只下载表头作为导入模板
- `POST /guides/import`：表单字段 `file`（.csv/.xlsx，列同导出模板）、`mode=preview|commit`；同名覆盖、新名新增

## 分析任务

上传的文件只存在于分析服务的临时工作区，数据库 `analysis_jobs` 只记录任务归属与状态；每个接口都校验任务属于当前用户。

- `POST /analysis/sanger/upload?filename=&job=`：请求体为单个 `.ab1`（或含 `.ab1` 的 `.zip`）二进制；不带 `job` 时新建任务，返回 `{job, files}`
- `POST /analysis/sanger/analyze`：`{job, sequence, target_position, target_base, edited_base, bystander_position?, files?, ref_sequence?, rename_config?}`；进入全站队列，立即返回 `202` 与排队状态。`bystander_position` 须在 guide 内、不等于目标位且与目标碱基同一种碱基；填写时网页把它展开到 `files`（已上传的服务器文件名）每一个上，作为分析服务的逐文件 `guide_overrides` 送出，结果多「Bystander_Position」「Bystander_Position_Edit_Rate」两列
- `POST /analysis/nanopore/upload?filename=`：请求体为厂商交付包 `.zip`，只解出 Sequences / Bam(`*.bam`) / Frequency_tables / Suspious_sites，返回 `{job, samples}`；分析结果 summary 末尾多 `Data_Source`（BAM / 频率表）与 `Data_Note`（频率表截断、空文件、与 BAM 不符等数据瑕疵）两列
- `POST /analysis/nanopore/analyze`：`{job, rows:[{file, guide, target_position, target_base, edited_base, bystander_position?}]}`；同样入队返回 `202`
- `GET /analysis/jobs/:id`：排队/运行状态 `{status: queued|running|done|failed|lost, position, wait_seconds, elapsed_seconds, estimate_seconds, remaining_seconds, queue_length, result?, error?}`
  - 完成时 `result.celebrate = {n, mine}`：本次成功样品数、本人累计同类（Sanger/纳米孔）样品数，页面据此显示「恭喜完成」提示
- `GET /analysis/jobs/:id/download`：结果 ZIP（Excel 汇总；Sanger 另含重命名后的 `.ab1`）
- `DELETE /analysis/jobs/:id`：立即清理临时任务

任务过期或已清理后返回 `410 Gone`；排队或运行中的任务不能追加文件、下载（`409`），运行中的任务不能清理（`409`），排队中的任务清理时移出队列。

排队策略：分析服务是单进程，网页服务维护一个全站先进先出队列（Sanger 与纳米孔共用），同一时间只运行一个任务。预计时长 = 固定开销 + 每文件（样本）平均耗时 × 数量，平均耗时按每个完成任务的实际耗时滑动更新。队列在网页服务内存中，服务重启后排队中的任务状态为 `lost`，需重新提交。

## 资源库

- `GET /cells`：`rack`、`layer`、`q`（名称/来源/存放人/备注模糊）、`source`、`depositor`、`medium`（冻存液；三者精确匹配）、`review=1`；同时返回 `options`（细胞名称、来源、冻存液、存放人的已有值，供下拉候选）
- `GET /cells/export`：同列表的筛选参数，另可带 `ids=1,2,3` 只导出勾选的记录；返回 `.xlsx`
- `POST /cells`
- `PATCH /cells/:id`（含修改管数；写入修改历史）
- `DELETE /cells/:id`（仅 admin）
- `GET /cells/:id/history`
- `POST /cells/import`：表单字段 `file`、`mode=preview|commit`；追加导入，跳过与现有记录完全相同的行
- `GET /materials`：`q`、`brand`、`requester`、`category`、`status`、`receipt`（后五项精确匹配）、`used_up=1`（仅已用完；默认未用完）、`sort`、`dir`、`page`；列表、总数与 `facets` 均受展示部门及使用状态限制，另返回 `departments`、`pending_count`
- `POST /materials/import`（仅 admin；`mode=preview|commit`；按采购单编码＋物料编码增量更新，保留本地标记；返回 `inserted/updated/unchanged`，不删除旧记录）
- `POST /materials/:id/usage`：`{action:"mark",confirmed:true}`；普通成员提交待审批申请，管理员直接标记；`restore/approve/reject` 仅 admin，超出展示部门的记录不可操作
- `GET /admin/materials/usage-requests?page=`：仅 admin，分页查询展示部门的未批准申请
- `POST /admin/materials/usage-requests`：仅 admin，`{ids,action:"approve"|"reject"}`，单次最多 500 条；已变化的状态跳过，任一 ID 不存在或超出范围则整批拒绝
- `GET /materials/stock`：常用耗材库存列表，所有登录用户；`category`（配置中的类别）、`q`（名称/品牌/规格/备注）、`status=unchecked|out|low|ok|stale`；返回 `categories`（含空类别的条目数/待核对/已用完/偏低/待复核）、`items`、`summary`、`stale_days`。未核对条目 `last_checked_at=null`，不计入已用完/偏低；`status=out` 表示数量为 0（已用完）
- `POST /materials/stock`：仅 admin，新增条目 `{category,item_name,brand?,spec_model?,unit?,quantity?,safety_stock?,note?}`；`quantity` 省略表示待核对；同名同品牌同规格重复返回 409
- `PATCH /materials/stock/:id`：仅 admin，修改类别/名称/品牌/规格/单位/安全库存/备注；传 `quantity` 返回 400（数量须走核对）
- `DELETE /materials/stock/:id`：仅 admin，删除条目及核对历史，审计写快照
- `POST /materials/stock/:id/check`：仅 admin，`{quantity,note?,expected_revision?}`；`revision` 不一致返回 409，成功写入核对历史并递增版本
- `GET /materials/stock/:id/checks?limit=10`：所有登录用户，最近核对历史（最多 50 条）
- `POST /materials/stock/sync`：仅 admin，从展示部门的启用采购记录按类别关键词生成缺失条目（数量 0、待核对）；返回 `{scanned,candidates,created,skipped}`，不改已有条目
- `GET /materials/reconcile/search?q=&months=2`：所有登录用户；按名称/品牌/规格（同时比较去空格文本）返回匹配的库存条目、最多 500 条采购记录、近 N 月 `recent/unreceived/partial` 标记、`suggested_material_ids`、`pending_material_ids`、`departments` 和 `summary.truncated`。只读，供 agent 核对
- `POST /materials/reconcile`：所有登录用户，`{stock_id?,proposed_quantity?,material_ids?,note,confirmed:true}`；创建待审批请求，不立即改库存或采购标记。`stock_id` 与 `material_ids` 至少一个；库存已有待审批请求时 `409`
- `GET /materials/reconcile?status=all|pending|approved|rejected&page=`：成员只看自己，admin 看全部；返回 `materials` 明细、`stock_changed`（提交后库存 revision 变化）
- `GET /materials/reconcile/:id`：本人或 admin；其他账号按 `404`
- `GET /admin/materials/reconcile?status=pending&page=`：仅 admin，审批队列
- `POST /admin/materials/reconcile`：仅 admin，`{ids,action:"approve"|"reject",note?}`；批准时事务内更新库存、写核对历史、标记采购记录为已用完并清理待审批申请；提交后库存 revision 变化或采购记录不存在时整批 `409`，需驳回重提
- `GET /assets`：固定资产查询，`q`、`user`、`category`、`location`、`sort`、`dir`、`page`
- `POST /assets/import`（仅 admin；`mode=preview|commit`；整表替换，只导入研发部）
- `GET /imports/:id/errors`：未导入行清单 CSV

## 冰箱管理

普通用户只能访问自己的容器和样品；管理员或有「冰箱总览」权限的成员在查询接口带 `scope=all`（可加 `owner=<用户 id>`）只读查看全部人员，修改接口对他们同样只作用于自己的数据。

- `GET /freezer/freezers`：冰箱清单（停用的仅管理员可见）
- `POST /freezer/freezers`、`PATCH /freezer/freezers/:id`、`DELETE /freezer/freezers/:id`：仅 admin；可带布局 `shelf_count`、`racks_per_shelf`（同时填或都不填）；有容器或架子的冰箱不能删除、布局缩小会切掉架子/容器时 `409`
- `GET /freezer/racks?freezer=`：该冰箱的架子（位置、分配人、规格、已用盒位数 `used`，不含内容），所有登录用户可看
- `POST /freezer/racks`：`{freezer_id, shelf_no, position, owner_id?, tiers?, depth?, remarks?}`；`PATCH /freezer/racks/:id`：`{owner_id, tiers, depth, remarks}`；`DELETE /freezer/racks/:id`：均仅 admin
- `GET /freezer/containers`：`scope`、`owner`、`freezer`；自己的视图含公共容器；返回位置与在库样品数
- `POST /freezer/containers`：`{freezer_id, kind: box|basket, name, shelf_no, rack_no?, slot_no?, tier_no?, depth_no?, is_shared?（仅 admin）, remarks?}`；放进别人或未分配的架子 `403`，格位已有盒子 `409`；无布局冰箱同位置已有盒子时返回 `warning`
- `PATCH /freezer/containers/:id`、`DELETE /freezer/containers/:id`（容器内有在库样品时 `409`）
- `GET /freezer/samples`：`scope`、`owner`、`freezer`、`status=stored|removed|all`（默认 stored）、`container`、`q`；同时返回各冰箱数量 `counts`（键为冰箱 id，另有 `all`）；`container` 为公共容器时返回其中所有人的样品
- `POST /freezer/samples`：批量存入 `{container_id | new_container, stored_on?, samples:[{name, project_no, sample_type, remarks}]}`，最多 500 管
- `PATCH /freezer/samples/:id`：修改样品信息；`DELETE /freezer/samples/:id`：删除录错记录
- `GET /freezer/samples/:id/history`：流转历史（本人、admin、有「冰箱总览」权限者；样品在公共容器里时所有人）
- `GET /freezer/owners`：全部人员视图的存放人筛选项（admin 或有「冰箱总览」权限者）
- `POST /freezer/samples/batch`：`{ids, action: remove|move, note?, container_id? | new_container?}`

## 留言板

- `GET /feedback?status=open|closed|all`：成员只返回自己的，admin 返回全部；每条带 `unread`
- `POST /feedback`：`{title, body}`
- `GET /feedback/:id`：详情与全部回复，同时标记已读；看不到的按 `404`
- `POST /feedback/:id/posts`：`{body}`，发起人或 admin
- `PATCH /feedback/:id`：`{status: open|closed}`，仅 admin
- `GET /feedback/unread`：`{count}`，导航栏角标

## 管理

- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users/:id`：启用/停用、角色、`freezer_view_all`（冰箱总览）、显示名、重置密码（停用或重置后该用户现有登录失效）
- `GET /admin/audit-logs`
