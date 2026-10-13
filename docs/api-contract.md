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
- `POST /analysis/sanger/analyze`：`{job, sequence, target_position, target_base, edited_base, ref_sequence?, rename_config?}`；进入全站队列，立即返回 `202` 与排队状态
- `POST /analysis/nanopore/upload?filename=`：请求体为厂商交付包 `.zip`，只解出 Sequences / Bam(`*.bam`) / Frequency_tables / Suspious_sites，返回 `{job, samples}`；分析结果 summary 末尾多 `Data_Source`（BAM / 频率表）与 `Data_Note`（频率表截断、空文件、与 BAM 不符等数据瑕疵）两列
- `POST /analysis/nanopore/analyze`：`{job, rows:[{file, guide, target_position, target_base, edited_base, bystander_position?}]}`；同样入队返回 `202`
- `GET /analysis/jobs/:id`：排队/运行状态 `{status: queued|running|done|failed|lost, position, wait_seconds, elapsed_seconds, estimate_seconds, remaining_seconds, queue_length, result?, error?}`
- `GET /analysis/jobs/:id/download`：结果 ZIP（Excel 汇总；Sanger 另含重命名后的 `.ab1`）
- `DELETE /analysis/jobs/:id`：立即清理临时任务

任务过期或已清理后返回 `410 Gone`；排队或运行中的任务不能追加文件、下载（`409`），运行中的任务不能清理（`409`），排队中的任务清理时移出队列。

排队策略：分析服务是单进程，网页服务维护一个全站先进先出队列（Sanger 与纳米孔共用），同一时间只运行一个任务。预计时长 = 固定开销 + 每文件（样本）平均耗时 × 数量，平均耗时按每个完成任务的实际耗时滑动更新。队列在网页服务内存中，服务重启后排队中的任务状态为 `lost`，需重新提交。

## 资源库

- `GET /cells`（支持按架号、层号、名称、存放人、待核对筛选）
- `POST /cells`
- `PATCH /cells/:id`（含修改管数；写入修改历史）
- `DELETE /cells/:id`（仅 admin）
- `GET /cells/:id/history`
- `POST /cells/import`：表单字段 `file`、`mode=preview|commit`；追加导入，跳过与现有记录完全相同的行
- `GET /materials`：`q`、`brand`、`requester`（模糊匹配）、`category`、`status`、`receipt`、`sort`、`dir`、`page`
- `POST /materials/import`（仅 admin；`mode=preview|commit`；整表替换）
- `GET /assets`：固定资产查询，`q`、`user`、`category`、`location`、`sort`、`dir`、`page`
- `POST /assets/import`（仅 admin；`mode=preview|commit`；整表替换，只导入研发部）
- `GET /imports/:id/errors`：未导入行清单 CSV

## 冰箱管理

普通用户只能访问自己的容器和样品；管理员或有「冰箱总览」权限的成员在查询接口带 `scope=all`（可加 `owner=<用户 id>`）只读查看全部人员，修改接口对他们同样只作用于自己的数据。

- `GET /freezer/freezers`：冰箱清单（停用的仅管理员可见）
- `POST /freezer/freezers`、`PATCH /freezer/freezers/:id`、`DELETE /freezer/freezers/:id`：仅 admin；有容器的冰箱不能删除（`409`）
- `GET /freezer/containers`：`scope`、`owner`、`temp`；返回位置与在库样品数
- `POST /freezer/containers`：`{freezer_id, kind: box|basket, name, shelf_no, rack_no?, slot_no?, remarks?}`；同位置已有盒子时返回 `warning`
- `PATCH /freezer/containers/:id`、`DELETE /freezer/containers/:id`（容器内有在库样品时 `409`）
- `GET /freezer/samples`：`scope`、`owner`、`temp`、`status=stored|removed|all`（默认 stored）、`container`、`q`；同时返回各温度数量 `counts`
- `POST /freezer/samples`：批量存入 `{container_id | new_container, stored_on?, samples:[{name, project_no, sample_type, remarks}]}`，最多 500 管
- `PATCH /freezer/samples/:id`：修改样品信息；`DELETE /freezer/samples/:id`：删除录错记录
- `GET /freezer/samples/:id/history`：流转历史（本人、admin 或有「冰箱总览」权限者）
- `GET /freezer/owners`：全部人员视图的存放人筛选项（admin 或有「冰箱总览」权限者）
- `POST /freezer/samples/batch`：`{ids, action: remove|move, note?, container_id? | new_container?}`

## 管理

- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users/:id`：启用/停用、角色、`freezer_view_all`（冰箱总览）、显示名、重置密码（停用或重置后该用户现有登录失效）
- `GET /admin/audit-logs`
