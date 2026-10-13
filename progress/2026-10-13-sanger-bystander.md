# 2026-10-13 Sanger 分析接入旁观位 + 旁观位同碱基校验

## What was done

- 用户问为何 Sanger 没用到旁观位。核实：EditR_wang 自 `7c734f4`（2026-09-16）起支持 Sanger 旁观位，本仓 `apps/r-engine` 复制自更晚的 `0ca92f0`，分析侧已具备；但它只接受逐文件 `guide_overrides` 里的旁观位（不设整批单值），而本仓 Sanger 页面与路由只送整批单值、从未送 overrides，所以旁观位一直没进分析。属 V1 接入遗漏。
- Sanger 页面：加「旁观位（可选）」输入，从 Guide 选择时回填；提交时附带已上传文件列表。
- Sanger 路由（`apps/web/src/app/api/v1/analysis/sanger/analyze/route.ts`）：校验旁观位（范围、≠目标位、同碱基），把整批同一个值展开成每个文件的 `{file, bystander_position}` overrides 送分析服务；不填不送。分析服务代码未改。
- 同碱基校验：`apps/web/src/lib/guides.ts` 新增 `bystanderBaseError`，Guide 保存/导入与 Sanger 提交共用；Guide 未填目标碱基时以目标位置上的碱基为准，两者都没填时不拦。
- 文档：`docs/api-contract.md`、`docs/data-model.md` 同步。

## Testing

- `apps/web`：`tsc --noEmit` 通过；eslint（改动文件）通过；vitest 31/31 通过（新增同碱基用例；原用例里旁观位 3 在测试序列上是 G，按新规则改为 1）。
- 本机端到端（本仓 R 分析服务 + EditR 上游示例 `example.ab1`，guide `GGAATGACACACGCCCGGCA`，目标 C3）：按路由同样的载荷送 `guide_overrides=[{file:"example.ab1", bystander_position:10}]`，结果 `Bystander_Position=C10`、`Bystander_Position_Edit_Rate=0`；不送时两列为空。结果表按数据列动态展示，无需改前端表格。
- 未验证：页面真实点击；Next 路由本身未起整套服务跑（其逻辑由类型检查与上述等价载荷覆盖）。

## Notes

- Changed files：`apps/web/src/lib/guides.ts`、`apps/web/src/lib/guides.test.ts`、`apps/web/src/app/api/v1/analysis/sanger/analyze/route.ts`、`apps/web/src/app/(app)/tools/sanger/page.tsx`、`docs/api-contract.md`、`docs/data-model.md`。
- 纳米孔分析页手填的旁观位未加同碱基校验（本轮范围为 Guide 保存与 Sanger 提交）；从 Guide 选来的值已在保存时校验过。
- 无数据库变更。已在线上存有旁观位的 Guide 不会被自动改动；若不满足同碱基，下次编辑保存时会提示。
- Rollback：还原上述文件。
