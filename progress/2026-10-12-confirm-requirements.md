# 2026-10-12 需求确认：细胞库、物料库与部署方式

## What was done

- 只读分析用户提供的《细胞冻存登记表》和《部门物料》两份表格（隔离副本，未进入仓库）以及 EditR_wang 源码结构、myserver 服务器资料。
- 根据用户确认的结论更新设计文档：
  - 物料库定位改为采购记录查询（数据源为采购系统「请购物料库」导出），管理员整表替换。
  - 细胞库位置记到架号 + 层号；取用即修改管数并自动留痕；登录用户可改、仅管理员可删；历史数据保留原文并标「待核对」。
  - 部署由「Windows + Docker」改为在 windows-wg 原生安装（该机为 Windows 10 LTSC 2019，无法运行 Docker）。
- 按真实列结构重写两份脱敏示例 CSV（虚构数据）。

## Testing

- 仅文档改动，无代码可测。已用 grep 核对文档中不再残留「Docker 作为生产部署」的描述。

## Notes

- Changed files：`README.md`、`docs/decisions.md`、`docs/data-model.md`、`docs/api-contract.md`、`docs/architecture.md`、`docs/development-plan.md`、`examples/cell_inventory.example.csv`、`examples/materials.example.csv`
- Rollback：`git checkout -- <上述文件>`，并删除本日志文件。
- 未连接任何服务器；`infra/` 下 Docker 文件保留未动，仅文档注明不用于生产。
