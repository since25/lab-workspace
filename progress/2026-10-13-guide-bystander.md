# 2026-10-13 Guide 增加选填「旁观位」

## What was done

- 用户验收纳米孔 BAM 部署通过；提出 Guide 属性缺下游要用的旁观位，要求挂上、选填。
- 数据库：新增迁移 `db/migrations/006_guide_bystander.sql`，`guides` 加一列 `bystander_position integer`（可空），现有数据不变。
- 校验（`apps/web/src/lib/guides.ts`）：选填；填写时须为序列范围内整数，且不能与目标位置相同（纳米孔分析里两者相同时旁观位会被忽略）。
- 新增 / 编辑 / 批量导入 / 导出 CSV 都带上旁观位；导入导出模板末尾加「旁观位」列，旧模板没有这一列仍可导入（视为未填）。
- 「我的 Guide」列表加「旁观位」列，编辑框加「旁观位（选填）」；纳米孔分析页从 Guide 选择时回填旁观位。Sanger 分析页本来没有旁观位输入，未改。
- 文档：`docs/data-model.md` 同步。

## Testing

- `apps/web`：`tsc --noEmit` 通过；eslint（改动文件）通过；vitest 27/27 通过，含新增 `src/lib/guides.test.ts`（选填、越界、与目标位相同、新旧模板导入）。
- 数据库语句：本机无 PostgreSQL，用 PGlite（内存 PostgreSQL）依次执行迁移 001–006，并执行与路由相同的新增 / 修改（清空）/ 导入覆盖语句，结果正确。
- 未验证：页面真实点击；生产部署（迁移会改线上表结构，需用户确认后再部署）。

## Notes

- Changed files：新增 `db/migrations/006_guide_bystander.sql`、`apps/web/src/lib/guides.test.ts`；修改 `apps/web/src/lib/{types,guides}.ts`、`apps/web/src/lib/imports/guides.ts`、`apps/web/src/app/api/v1/guides/{route.ts,[id]/route.ts,import/route.ts,export/route.ts}`、`apps/web/src/app/(app)/guides/page.tsx`、`apps/web/src/app/(app)/tools/nanopore/page.tsx`、`docs/data-model.md`。
- 已知取舍：用旧模板（无「旁观位」列）覆盖导入同名 Guide 时，旁观位会被清空——与其他列缺失时的现有行为一致。
- 未做 Git 提交；未部署。
- Rollback：还原上述文件；如已部署，`ALTER TABLE guides DROP COLUMN bystander_position;` 并从 schema_migrations 删除 006 记录。
