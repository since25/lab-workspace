# 2026-10-13 分析看板与完成祝贺

## What was done

- 首页新增「分析看板」三块数字：我分析的 Sanger 样品数、我分析的纳米孔样品数、全站累计分析样品数（只显示总数，不分来源/人）。
- 数据来源：操作记录中每次分析完成（`analysis.run`）记下的成功样品数求和；不新增数据表、无迁移，上线即包含历史分析。同一批重新分析会再计一次。
- Sanger、纳米孔分析完成且有成功样品时，结果上方显示绿色提示：「🎉 恭喜完成 N 个样品的 X 分析！你累计已分析 X 样品 M 个。」
- 文档：`README.md`、`docs/api-contract.md`。

## Testing

- `apps/web`：`tsc --noEmit` 通过；改动文件 eslint 无报错；vitest 32/32 通过。
- 临时 PostgreSQL 16（001–008 迁移）：构造数字与单元素数组两种 `n_success`、缺字段、非分析类操作，统计 SQL 结果正确（个人 Sanger 5、纳米孔 5、全站 17）。
- 本机 `next dev` 登录后首页渲染出三块看板、无服务端报错。
- 未做：带 R 分析服务的端到端分析（祝贺提示的界面未实际点出，仅类型检查覆盖）。临时数据库和开发服务器已清理。

## Notes

- Changed files：`apps/web/src/lib/stats.ts`（新增）、`apps/web/src/app/(app)/page.tsx`、`apps/web/src/app/(app)/tools/{shared.tsx,sanger/page.tsx,nanopore/page.tsx}`、`apps/web/src/app/api/v1/analysis/{sanger,nanopore}/analyze/route.ts`、`apps/web/src/app/globals.css`、`README.md`、`docs/api-contract.md`。
- Rollback：代码回退即可，无数据库变更。
