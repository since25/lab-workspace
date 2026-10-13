# 开发计划

## Phase 0：准备（当前）

- 固化需求边界、权限规则和数据生命周期
- 建立 Next.js、R plumber、PostgreSQL 的 Compose 骨架
- 设计导入模板和校验错误格式
- 从 EditR_wang 标记可迁移的 Sanger/Nanopore 算法函数

## Phase 1：平台底座

- 登录、会话、管理员创建账号
- PostgreSQL migration、健康检查、审计日志
- 临时任务目录、TTL 清理器、统一错误处理
- Windows Docker Desktop 部署说明

验收：管理员能创建/停用用户；普通用户不能访问管理接口；过期任务文件自动消失。

## Phase 2：Guide 与资源库

- 用户独立 Guide CRUD、序列校验和 CSV 导出
- 细胞库 xlsx/csv 导入、预览、错误行下载、查询和单条录入
- 部门物料管理员导入、导入批次替换、全员只读查询

验收：导入不合格行可定位；普通用户无法写入物料库；数据重启后仍存在。

## Phase 3：分析工具

- Sanger 单序列分析 API 与 R 适配层
- Nanopore 解析与编辑效率结果
- 文件重命名预览与 ZIP 导出
- CSV/XLSX 结果下载

验收：使用固定脱敏 fixtures 得到稳定结果；分析结果可下载；不产生长期归档。

## Phase 4：联调与交付

- 权限、上传安全、并发和清理策略测试
- Compose 一键启动/停止/备份恢复文档
- 生产环境变量清单、管理员操作手册
- 发布第一个可用版本（V1）

## 主要风险

- EditR 算法与新 API 的输入输出不一致：先建立 fixtures 和黄金结果。
- Windows Docker 文件权限/路径差异：所有路径通过环境变量配置并在 Windows CI/预发布机验证。
- 大型 Nanopore 文件占用空间：限制单任务大小、并发数和 TTL。
- 原始表格列名漂移：导入器采用列别名映射并提供预览确认。
