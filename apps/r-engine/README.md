# 分析服务（R plumber）

Sanger 编辑效率与纳米孔交付包分析。算法与处理函数从 EditR_wang（提交 `0ca92f0`）的 `R/` 目录复制，只保留 Sanger、纳米孔、结果打包和重命名；归档、Hub 推送、SQLite 模板库未迁移。该部分沿用 EditR 的 GPL-3.0 许可（见 `LICENSE-EditR`）。

- 入口：`Rscript start.R`，只监听 `127.0.0.1:${R_ENGINE_PORT:-8001}`，由网页服务转发并负责鉴权。
- 临时文件：`LAB_TEMP_DIR`，按 `TEMP_JOB_TTL_HOURS`（默认 24）自动清理。
- Windows 上必须设 `EDITR_ENABLE_PARALLEL=false`（`mclapply` 不支持 Windows 多进程）。
- 相对 EditR 的改动：`handlers_nanopore.R` 上传时只解出 Sequences / Bam(`*.bam`) / Frequency_tables / Suspious_sites，便于直接上传厂商整包；summary 末尾加 `Data_Source` / `Data_Note` 两列。`nanopore.R` 的 BAM 主源（2026-10-13）已同步回 EditR_wang。
- 测试：`Rscript tests/test_*.R`（数据均为合成或上游公开示例）。
