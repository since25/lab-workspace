# Lab Workspace

实验室内部多用户分析与资源管理平台（设计与开发准备仓库）。

## 项目定位

Lab Workspace 将两个场景放在一个部署中（实验室主机 windows-wg 原生安装）：

1. **即用即走的测序分析工具**：Sanger 单序列分析（含结果命名规则）、Nanopore 分析、Guide 辅助和结果导出。上传文件仅在临时工作区存在，任务完成后按清理策略删除，不建立测序历史归档。
2. **持久化实验室资源管理**：用户账号、个人 Guide 库、细胞冻存库、冰箱样品管理、部门物料库和固定资产台账保存在 PostgreSQL 中。

本项目与 daily-work / Hub 完全独立，不对接 Grist、eLabFTW、外部 webhook 或推送系统。

## 当前状态

V1 功能已开发完成：登录与账号管理、细胞冻存库、冰箱管理（-80/-20/4℃，盒子/框定位，批量存入、取出、转移，管理员只读总览）、部门物料（采购记录查询）、常用耗材（库存核对）、固定资产（按物品汇总，默认研发部，展示部门可配置）、个人 Guide 库（含批量导入）、Sanger（含结果命名规则）与纳米孔分析（全站排队）、操作记录。2026-10-13 增加：细胞冻存导出 Excel、下拉候选与低库存提醒；冰箱按台分选项卡、-80℃ 布局图（架子分配、点格放盒、公共框）；留言板（成员向管理员反馈，角标提示未读）。首页分析看板：个人分别统计 Sanger、纳米孔分析的样品数，全站只显示累计总数（取自操作记录中的分析完成记录，不新增数据表）；分析完成后提示「恭喜完成 N 个样品分析」。部署与运维见 [`docs/deployment.md`](docs/deployment.md)。

2026-10-15 物料增量同步、指定部门展示、已用完申请审批和每周六 OA 自动同步已部署到 windows-wg。行为及验收见 [`docs/materials-update-plan.md`](docs/materials-update-plan.md)。

2026-10-16 固定资产台账改为全量入库（所有部门）＋「按物品汇总」视图：同名同规格、不同存放地点的资产只占一行，展开看每个地点的资产编号；页面展示哪些部门由 `ASSET_DISPLAY_DEPARTMENTS_JSON` 配置（默认研发部）。详见 [`progress/2026-10-16-assets-grouping.md`](progress/2026-10-16-assets-grouping.md)。


2026-10-20 新增独立选项卡「常用耗材」：按配置类别汇总吸头、细胞培养板、移液管、离心管、培养基等，记录当前库存/安全库存与每次核对历史，支持管理员手工核对、从采购记录生成候选待核对条目，库存与 OA 采购记录分表保存。成员或 agent 可提交「库存校对请求」（同时建议库存数量和待标记的采购记录），管理员在「物料审批 → 库存校对」批准后生效；agent 通过 `apps/mcp-server` 的 MCP 工具对话式调用。2026-10-21 起改为「固定规格槽位」：每行是一个规格（如 200µL 滤芯吸头），品牌货号挂在槽位下；采购按规则建议归位、管理员在「核对工作台」确认，第一次核对为基线，之后按采购入库确认 + 定期盘点更新。设计与操作见 [`docs/consumable-stock.md`](docs/consumable-stock.md)，agent 接入见 [`docs/agent-mcp.md`](docs/agent-mcp.md)，采购周期与开源选型调研见 [`docs/material-inventory-research.md`](docs/material-inventory-research.md)。

## 目录

- `docs/architecture.md`：总体架构、模块边界和数据生命周期
- `docs/data-model.md`：核心数据模型和权限规则
- `docs/api-contract.md`：V1 API 草案
- `docs/development-plan.md`：开发阶段、验收标准和风险
- `docs/decisions.md`：已确认的架构决策
- `docs/deployment.md`：windows-wg 部署、升级、备份与回滚
- `docs/consumable-stock.md`：常用耗材库存的类别配置、状态口径、API 与核对流程
- `docs/material-inventory-research.md`：采购周期取数方法、访谈提纲与开源库存项目评估
- `docs/agent-mcp.md`：用 MCP agent 查询采购/库存并提交待审批的库存校对请求
- `docs/label-print.md`：标签打印的来源、纸张与模板字号、打印流程与设备登记
- `apps/web/`：网页与 API（Next.js）
- `apps/r-engine/`：分析服务（R plumber，算法来自 EditR_wang）
- `apps/mcp-server/`：给 agent 用的 MCP stdio 服务（检索采购/库存、提交库存校对请求）
- `examples/`：完全脱敏的导入示例，禁止放入实验室原始表格
- `infra/windows/`：安装包生成与 windows-wg 安装、守护、备份、卸载脚本；`infra/docker-compose.yml` 仅可选用于本地开发数据库
- `db/migrations/`：数据库结构迁移

## 技术栈

- Web/API：Next.js + TypeScript
- 数据库：PostgreSQL 16
- 分析服务：R + plumber（从 EditR_wang 选择性迁移算法）
- 临时文件：本机临时工作区，按 TTL 清理
- 部署：windows-wg（Windows 10 LTSC 2019）原生安装，不使用 Docker

## 明确不做

作图、测序数据长期归档、内部分享/推送、OA 物料之外的外部系统同步、普通用户修改物料采购字段或自行恢复已用完、daily-work / Hub 业务耦合。
