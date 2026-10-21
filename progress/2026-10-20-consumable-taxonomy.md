# 常用耗材：四大类两级分类、三态状态、自动列与异名归一（TASK-63～69）

- 日期：2026-10-20
- 工作区：`/Users/wangyichuan/localissue/lab-workspace-task-63`
- 分支：`task-63`（基于 `main` 提交 `651abac`；未提交、未推送、未部署，主工作区未改动）
- 依据：`lab-workspace-work/cs_temp/stock-candidates-2026-10-20/taxonomy-proposal.md`

## What was done

- TASK-63 两级分类：`consumables.ts` 内置类别改为「大类/子类」（普通用品 4、塑料耗材 8、生物试剂 3、试剂盒 5 个子类 + 其他），关键词中英双语；`stockGroup/stockGroups` 取大类；列表接口新增 `groups`（大类汇总），`category` 参数可传大类（按前缀过滤）或完整子类；页面标签卡 = 全部 + 大类，行内灰色小标签显示子类，新增/编辑的类别下拉按大类分组。改类别仍只改 `MATERIAL_STOCK_CATEGORIES_JSON`。
- TASK-66 候选生成：关键词对齐新子类；命中多个类别取最长关键词；去掉易误伤的 `label/filter/pipette/eppendorf/zol/race/glutamax` 等；候选只取近 12 个月、异名合并后 ≥2 笔的复购品；已有同归一键条目不再新建。
- TASK-64 三态：`stockStatus` 改为 out（已核对且 0）/ stale（从未核对或超过 30 天）/ ok；接口不再返回 `safety_stock`，新增/编辑忽略该字段，`summary` 去掉 `unchecked_count/low_count`；页面去掉安全库存列和表单项；库存校对检索的状态文字同步改。数据库 `safety_stock` 列保留。
- TASK-67 异名归一：新增 `stock-normalize.ts`（品牌别名表、品目同义词表、`货号:xx 名称:xx` 清理、200T 规格统一、归一键），用于候选入库前合并与自动列关联。单位不归一（策略待定）。
- TASK-65 列与自动列：列顺序改为 类别｜耗材名称｜品牌｜规格型号｜单位｜当前库存｜状态｜最近核对｜参考消耗/月*｜最近采购*｜操作；两列由 `listStock` 按归一键关联展示部门非停用采购记录自动计算（参考消耗 = 同单位采购量合计 ÷ 首末采购跨越月数，≥2 笔才给出）。日期以 `::text` 取出避免时区差一天。
- TASK-68 仅做本地准备：`final_import.csv` 41 条按新子类重打类别并做品牌归一，生成 `lab-workspace-work/cs_temp/stock-candidates-2026-10-20/final_import_v2.csv`（仓库外，含采购人信息不进 Git）；内存库试导入 41/41 通过。生产入库与实地盘点未做。
- TASK-69：按任务正文「暂不做」，未实施，只在文档「明确不做」中注明。
- UI 检查脚本 `scripts/check-consumable-stock-ui.mjs` 改为对比库存页改动前（HEAD）与改动后。
- 文档：`docs/consumable-stock.md`、`api-contract.md`、`data-model.md`、`agent-mcp.md`、`deployment.md`、`decisions.md`。

## Testing

- `cd apps/web && npx vitest run`：13 个文件 103 条全部通过（含新增 `stock-normalize.test.ts` 5 条；`consumable-stock.test.ts` 17 条）。
- `npx tsc --noEmit`：本轮文件无错误；仅有 Next 生成类型 `PageProps/LayoutProps/RouteContext` 未生成时的既有报错（`npm run build` 生成后通过）。
- `npm run build`：退出码 0。
- `npm run lint`：0 错误，3 条既有警告（不在本轮文件）。
- `cd apps/mcp-server && npm test`：2 通过 0 失败。
- `node scripts/check-consumable-stock-ui.mjs`：passed，12 项检查；截图在工作区 `tmp/consumable-stock-ui-check/`（before-stock / member-stock / tab-plastic / admin-stock / admin-create）。
- 改造前该脚本在 `main` 上已失败（「改动前导航不应有常用耗材」：脚本拿 HEAD 当改动前，TASK-56 提交后两边相同），属既有问题，已随本轮重写。
- 离线真实数据核对（脚本在会话临时目录，数据不入仓库）：展示部门采购导出 886 条非停用 / 749 组 → 候选 28 组（原 6 组），7 个高频漏项全部命中，无抗体/原代细胞/耳标/脂质原料；归一后 749 → 739 组。
- 未测：生产库实际运行「生成候选」、生产 `lab.env` 配置、实地盘点。

## Notes

- 待用户决定：① 是否接受「参考消耗/月」按跨越月数而非方案稿的「有采购月份数」计算；② `final_import_v2.csv` 的类别分布（塑料 18 / 生物试剂 14 / 试剂盒 5 / 普通用品 4）与方案初版（15/11/10/5）不同，需确认定稿后才入库；③ 生产入库与部署需单独授权。
- 部署注意：生产 `lab.env` 若设置过旧五类 `MATERIAL_STOCK_CATEGORIES_JSON`，需删除或替换为新格式。

### Changed files

- `apps/web/src/lib/consumables.ts`、`consumable-stock.ts`、`stock-normalize.ts`（新）、`stock-reconcile.ts`
- `apps/web/src/app/(app)/materials/stock/page.tsx`、`src/app/api/v1/materials/stock/route.ts`、`src/app/globals.css`
- 测试：`consumable-stock.test.ts`、`stock-normalize.test.ts`（新）、`stock-reconcile.test.ts`、`reconcile-routes.test.ts`；`scripts/check-consumable-stock-ui.mjs`
- 文档：见上

### Rollback

- 未提交：删除工作区即可（`git worktree remove ../lab-workspace-task-63` 并删分支 `task-63`）。
- 合并后回滚：还原上述文件；无数据库迁移，`safety_stock` 列和数据未动；已用新类别名建的库存条目需手工改回旧类别。

### 2026-10-20 晚补充（代码侧收尾）

- 复跑全量测试 103 条通过、`npm run build` 通过。
- 修 `docs/api-contract.md` PATCH 行（去掉「安全库存」）与 `docs/agent-mcp.md` 示例（`low`/「低于安全库存」改三态与「正常」）。
- 新增部署与验收清单 `progress/2026-10-20-consumable-deploy-checklist.md`。
- 部署清单里注明：导入 41 条时 `quantity` 必须留空，不能把 CSV 的「入库数量 0」写成 0，否则全部误报「已用完」。
- 状态仍为待验收：业务验收需合并、部署后在线上完成；合并与部署待授权。
