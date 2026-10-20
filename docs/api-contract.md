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
- `GET /assets`：固定资产查询，默认返回汇总视图。
  - `view=group`（默认）：按「资产名称＋规格型号＋使用部门」汇总，每行带 `item_count`、`total_quantity`、`location_count` 与 `locations:[{location,item_count,total_quantity}]` 地点分布；100 组一页。
  - `view=item`：逐条明细，50 条一页。
  - `view=detail`：配合 `name`＋`spec`＋`group_department` 展开某个分组的明细（上限 500 条），沿用当前筛选。
  - 筛选：`q`（同时匹配名称、规格型号与两套资产编号）、`user`（模糊）、`category`、`location`、`department`（后三项精确），`sort`、`dir`、`page`；三种视图共用同一套筛选，保证汇总的地点条数与展开明细一致。
  - 展示范围：`ASSET_DISPLAY_DEPARTMENTS_JSON`（`lab.env`）配置的部门数组，未配置时默认只展示研发部，配置 `["*"]` 表示不限部门；范围外的数据即使用 `department` 参数指定也不会返回。响应含 `departments`（当前范围，空数组表示不限）、`facets.department`（范围内的部门候选）与 `total_rows`（台账全量条数）。
- `POST /assets/import`（仅 admin；`mode=preview|commit`；整表替换，台账全量入库，预览返回按部门条数与跳过行原因）
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
