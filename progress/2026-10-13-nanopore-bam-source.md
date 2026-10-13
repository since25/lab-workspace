# 2026-10-13 纳米孔取数改为 BAM 主源（复核 + 落地）

## What was done

- 复核 `docs/nanopore-data-source.md` 与 `docs/decisions.md` 的「纳米孔取数源」：用独立脚本只读解析本机原始交付包，确认 56/56 管 BAM 逐位点计数与频率表逐格相等（含 Depth、Del、Ins），4 管频率表截断属实；补出原稿没写的两点：插入要记在插入之后那一位才对得上；`memDecompress` 只解 BGZF 第一段，必须用 `gzfile()`。
- 修正原稿：截断文件的完整行数是 156/273/431/510（原稿把半行算进去）；「fastq 最后兜底」改为「暂不接入」（需比对器）；文档里的真实订单号、样品编号、guide 序列、本机路径换成占位符（文档尚未提交过）。
- `apps/r-engine/R/nanopore.R`：新增纯 R 的 `nano_read_bam()`，有可用 BAM 时用它作逐位点读值，否则回退频率表；`nano_read_table()` 丢掉不以换行结尾的半行；`nano_frequency_defect()` 记录频率表为空 / 截断 / 与 BAM 不符；读不出原因分「频率表被截断（数据瑕疵）」「深度 0」与原有几类；每样本带 `source` / `data_note`，`nano_analyze_rows()` 返回 `sources`。频率表为空的原文案保持不变（它在 EditR 推 Hub 的金样里）。
- `apps/r-engine/R/handlers_nanopore.R`：上传时多解出 `Bam/*.bam`（`.bai`、fastq、QC 仍不落盘）；summary 末尾加 `Data_Source`、`Data_Note` 两列（页面与下载 Excel 可见）。
- 页面说明文字、上传路由注释、`docs/api-contract.md`、`apps/r-engine/README.md`、`docs/decisions.md` 同步。
- 同一套取数逻辑同步到 EditR_wang（另见该仓 progress）。

## Testing

- `apps/r-engine/tests/` 6 个测试全部通过，含新增 `test_nanopore_bam.R`（合成 BAM：软剪切、插入、缺失、N、secondary/supplementary；截断有/无 BAM；计数不符；BAM 损坏与长度不符回退；深度 0）与更新后的 `test_nanopore_upload.R`。
- `apps/web`：`tsc --noEmit` 通过。
- 本机只读核对真实那单：56/56 管走 BAM、全部可读，4 管记「频率表疑似截断」，原报错那管目标位 8.44%（深度 391），整单读包约 3 秒。结果未写入仓库。
- 未验证：页面上传真实整包的端到端操作、生产部署。

## Notes

- Changed files：`apps/r-engine/R/nanopore.R`、`apps/r-engine/R/handlers_nanopore.R`、`apps/r-engine/tests/fixtures/nanopore_synth.R`、`apps/r-engine/tests/test_nanopore_upload.R`、新增 `apps/r-engine/tests/test_nanopore_bam.R`、`apps/web/src/app/(app)/tools/nanopore/page.tsx`、`apps/web/src/app/api/v1/analysis/nanopore/upload/route.ts`、`apps/r-engine/README.md`、`docs/{nanopore-data-source,decisions,api-contract}.md`。
- 上传体积：每管多约 100 KB 落盘；原本就是整包上传，请求体不变。
- 未做 Git 提交；未部署。
- Rollback：还原上述文件即可，无数据结构变化。
