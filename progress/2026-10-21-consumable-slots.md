# 常用耗材改为固定规格槽位（台账初配 → 人工核对基线 → 入库确认 + 定期盘点）

- 日期：2026-10-21（北京时间）
- 工作区：主工作区 `main`，未提交、未推送、未部署
- 依据：用户确认的演示稿（`work/code-guides/consumable-slots-demo.html`）与五条答复：库存记在槽位；按采购单位整箱计不拆、0 即需采购；槽位清单增删（非 TC/U 底/150mm/多层瓶不算，皿/瓶/筛/冻存管归细胞耗材，细菌皿/巴氏吸管/加样槽/手套/日用品合并，添加物并入培养基）；QuickExtract/MessengerMAX/Polyplus/感受态/Phanta 建单品槽位；线上旧候选可清掉

## What was done

- 迁移 `013_consumable_slots.sql`：`consumable_stock` 加 `slot_key`、`baseline_at`（旧条目回填）；核对历史加 `kind`（盘点/入库）；新表 `consumable_stock_skus`（货号 → 槽位记忆，空 = 排除）和 `consumable_stock_links`（采购 → 槽位与处理状态）。不改 `material_items`。
- 新增 `consumable-slots.ts`：58 个槽位模板（细胞耗材 12、塑料耗材 18、通用耗材 12、培养基 11、常用试剂 5）和匹配规则（容量/滤芯/孔数/TC 等），给出高/中/低把握；试剂盒/抗体字样降低、OA 小类不符降中。
- `consumable-stock.ts`：列表改为槽位视图（已挂货号、基线、待入库数、消耗/月按盘点差优先、最近采购取已归入采购）；新增建模板、匹配采购、核对工作台列表与处理（确认/改归/排除/入库/不加数）；首次核对写基线；删除旧「从采购记录生成候选」。
- 默认类别改为模板中的五大类 + 其他；`keywords` 只为兼容旧配置保留。状态文字「已用完」改为「需采购」（接口值仍为 `out`，库存校对检索同步）。
- 页面：常用耗材页（建立槽位模板、匹配采购记录、核对工作台入口带角标、新增槽位、已挂货号展开、基线日、待入库提示、消耗/月 * 标记、历史区分盘点/入库）；新页面 `/materials/stock/review` 核对工作台（待确认归属按槽位分组、改归下拉、一键确认高把握；待入库可改数量、单位不符提示；已处理可改判）。
- 新路由：`POST /materials/stock/templates`、`GET /materials/stock/links`、`POST /materials/stock/links/:id`；`POST /materials/stock/sync` 改为匹配采购记录。
- 文档：`docs/consumable-stock.md` 重写；`api-contract.md`、`data-model.md`、`decisions.md`、`deployment.md`、`agent-mcp.md`、`README.md` 同步。

## Testing

- `cd apps/web && npx vitest run`：14 个文件 107 条全部通过（新增 `consumable-slots.test.ts` 5 条；`consumable-stock.test.ts` 改写为模板/匹配/工作台/基线入库/消耗计算）。
- `npx tsc --noEmit`：无错误（`npm run build` 生成路由类型后）。
- `npm run build`：退出码 0。`npm run lint`：0 错误，3 条既有警告（不在本轮文件）。
- `cd apps/mcp-server && npm test`：2 通过 0 失败。
- `node scripts/check-consumable-stock-ui.mjs`：passed，15 项检查；截图 `tmp/consumable-stock-ui-check/`（before-stock、member-stock、tab-cell、admin-stock、admin-create、review-pending、review-inbound、review-done）。用虚构 API 数据，不连数据库。
- 离线真实数据试跑（2026-10-20 生产导出 886 条启用记录，导入内存库，数据不入仓库）：建 58 个槽位；匹配给出建议 196 条（高 183、中 9、低 4），690 条长尾不归位；只有「48孔板 TC」无采购记录。中/低把握为包被板、未 TC 培养瓶、小类标成耗材的 DMEM/PBS/生理盐水、Polyplus 其他产品、Phanta Ultra/Uc，均需人工确认。
- 未测：生产库迁移、真实页面操作、旧候选清理。

## Notes

- 与演示稿的差异：入库由管理员在工作台直接确认（管理员本身是审批人），没有再走「库存校对请求」审批；成员/agent 的校对请求流程不变。
- 48孔板 TC 按演示稿保留为模板槽位（台账无采购），不需要可在页面删除。感受态只建了 DH5α（台账复购最多）；Trans109、Stbl3/4、DB3.1 等未建槽位，需要可手工新增。
- 未拆箱：采购单位与槽位单位不同（如 1.5mL 离心管有「盒」也有「箱」）时工作台只提示，由管理员填换算后的数。
- **部署时待授权的线上操作**（尚未执行）：
  1. 备份数据库；
  2. 部署后先只读查看旧条目：`SELECT id, category, item_name, quantity, last_checked_at FROM consumable_stock WHERE slot_key IS NULL;`
  3. 清理旧「生成候选」条目（用户已同意，执行前再确认数量）：`DELETE FROM consumable_stock WHERE slot_key IS NULL AND note = '由采购记录生成，待首次核对';`（级联删除其核对历史，库存校对请求的关联置空）；
  4. 管理员在页面依次：建立槽位模板 → 匹配采购记录 → 核对工作台确认 → 逐槽位第一次核对。

### Changed files

- 新增：`db/migrations/013_consumable_slots.sql`、`apps/web/src/lib/consumable-slots.ts`、`consumable-slots.test.ts`、`src/app/(app)/materials/stock/review/page.tsx`、`src/app/api/v1/materials/stock/templates/route.ts`、`links/route.ts`、`links/[id]/route.ts`
- 修改：`consumable-stock.ts`、`consumables.ts`、`stock-reconcile.ts`、`materials/stock/page.tsx`、`stock/route.ts`、`stock/sync/route.ts`、`globals.css`、相关测试与 `scripts/check-consumable-stock-ui.mjs`、文档见上

### Rollback

- 未提交：`git checkout` 还原上述修改文件并删除新增文件即可。
- 部署后回滚：恢复部署前备份；只回滚代码时，新表和新列不影响旧版本运行。
