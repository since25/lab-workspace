# Lab Workspace

实验室内部多用户分析与资源管理平台（设计与开发准备仓库）。

## 项目定位

Lab Workspace 将两个场景放在一个部署中（实验室主机 windows-wg 原生安装）：

1. **即用即走的测序分析工具**：Sanger 单序列分析（含结果命名规则）、Nanopore 分析、Guide 辅助和结果导出。上传文件仅在临时工作区存在，任务完成后按清理策略删除，不建立测序历史归档。
2. **持久化实验室资源管理**：用户账号、个人 Guide 库、细胞冻存库、冰箱样品管理、部门物料库和固定资产台账保存在 PostgreSQL 中。

本项目与 daily-work / Hub 完全独立，不对接 Grist、eLabFTW、外部 webhook 或推送系统。

## 当前状态

V1 功能已开发完成：登录与账号管理、细胞冻存库、冰箱管理（-80/-20/4℃，盒子/框定位，批量存入、取出、转移，管理员只读总览）、部门物料（采购记录查询）、固定资产（研发部）、个人 Guide 库（含批量导入）、Sanger（含结果命名规则）与纳米孔分析（全站排队）、操作记录。2026-10-13 增加：细胞冻存导出 Excel、下拉候选与低库存提醒；冰箱按台分选项卡、-80℃ 布局图（架子分配、点格放盒、公共框）；留言板（成员向管理员反馈，角标提示未读）。部署与运维见 [`docs/deployment.md`](docs/deployment.md)。

## 目录

- `docs/architecture.md`：总体架构、模块边界和数据生命周期
- `docs/data-model.md`：核心数据模型和权限规则
- `docs/api-contract.md`：V1 API 草案
- `docs/development-plan.md`：开发阶段、验收标准和风险
- `docs/decisions.md`：已确认的架构决策
- `docs/deployment.md`：windows-wg 部署、升级、备份与回滚
- `apps/web/`：网页与 API（Next.js）
- `apps/r-engine/`：分析服务（R plumber，算法来自 EditR_wang）
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

作图、测序数据长期归档、内部分享/推送、外部系统同步、普通用户维护部门物料、daily-work / Hub 业务耦合。
