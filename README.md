# Lab Workspace

实验室内部多用户分析与资源管理平台（设计与开发准备仓库）。

## 项目定位

Lab Workspace 将两个场景放在一个 Windows + Docker Compose 部署中：

1. **即用即走的测序分析工具**：Sanger 单序列分析、Nanopore 分析、Guide 辅助、文件重命名和结果导出。上传文件仅在临时工作区存在，任务完成后按清理策略删除，不建立测序历史归档。
2. **持久化实验室资源管理**：用户账号、个人 Guide 库、细胞冻存库和部门物料库保存在 PostgreSQL 中。

本项目与 daily-work / Hub 完全独立，不对接 Grist、eLabFTW、外部 webhook 或推送系统。

## 当前状态

这是框架设计和开发准备仓库，尚未包含生产代码。架构、数据模型、API 边界、部署方式和分阶段计划见 [`docs/`](docs/)。

## 目录

- `docs/architecture.md`：总体架构、模块边界和数据生命周期
- `docs/data-model.md`：核心数据模型和权限规则
- `docs/api-contract.md`：V1 API 草案
- `docs/development-plan.md`：开发阶段、验收标准和风险
- `docs/decisions.md`：已确认的架构决策
- `examples/`：完全脱敏的导入示例，禁止放入实验室原始表格
- `infra/`：Docker Compose 与环境变量模板
- `db/`：数据库迁移预留目录

## 计划技术栈

- Web/API：Next.js + TypeScript
- 数据库：PostgreSQL 16
- 分析服务：R + plumber（从 EditR_wang 选择性迁移算法）
- 临时文件：应用容器共享临时卷，按 TTL 清理
- 部署：Windows Server + Docker Desktop + Docker Compose

## 明确不做

作图、测序数据长期归档、内部分享/推送、外部系统同步、普通用户维护部门物料、daily-work / Hub 业务耦合。
