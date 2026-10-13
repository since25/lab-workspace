# 已确认的架构决策

| 决策 | 结论 |
|---|---|
| 项目边界 | 与 daily-work / Hub 完全独立 |
| 部署 | Windows Server + Docker Compose |
| 分析数据 | 临时保存，下载后按 TTL 清理，不建历史归档 |
| 业务数据 | Guide、细胞、物料持久化到 PostgreSQL |
| Guide 隔离 | 每个用户独立，按 owner_id 强制隔离 |
| 物料维护 | 仅管理员通过 xlsx/csv 导入；普通用户只读 |
| 作图 | V1 不包含 |
| 推送/分享 | V1 不包含 |
| 外部系统 | V1 不对接 Hub、Grist、eLabFTW、webhook |
| 原始数据 | 不进入 Git，不进入生产数据库 |
