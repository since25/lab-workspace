# 纳米孔 BAM 主源（2026-10-13）：BAM 读取口径、频率表瑕疵检测、读不出原因分类。
# 数据全部由 fixtures/nanopore_synth.R 合成，不含真实样本。
# 用法：在 apps/r-engine 目录下 Rscript tests/test_nanopore_bam.R
source("R/nanopore.R")
source("tests/fixtures/nanopore_synth.R")
by_slot <- function(xs) setNames(xs, vapply(xs, function(x) x$slot, character(1)))
approx <- function(a, b, tol = 0.001) !is.na(a) && abs(a - b) <= tol

# ── BAM 读取口径 ─────────────────────────────────────────────────────────
ref <- "ACGTACGTAC"   # 10
bam_path <- file.path(tempfile("bam_"), "x.bam")
write_bam(bam_path, nchar(ref), list(
  list(pos = 0L, cigar = "2S10M2S", seq = "TTACGTACGTACTT"),     # 软剪切两头
  list(pos = 0L, cigar = "4M1I6M", seq = "ACGTGACGTAC"),          # 第 4、5 位之间插入
  list(pos = 2L, cigar = "2M2D4M", seq = "GTGTAC"),               # 第 5–6 位缺失
  list(pos = 0L, cigar = "10M", seq = "ACGTNCGTAC"),              # 第 5 位读成 N：进深度不进 ACGT
  list(pos = 0L, cigar = "10M", seq = "GGGGGGGGGG", flag = 256L), # secondary：跳过
  list(pos = 0L, cigar = "10M", seq = "GGGGGGGGGG", flag = 2048L) # supplementary：跳过
))
m <- nano_read_bam(bam_path)
stopifnot(nrow(m) == 10, identical(m$Position, 1:10))
stopifnot(m$A_num[1] == 3, m$Depth[1] == 3)                         # 第 3 条从第 3 位开始
stopifnot(m$Del_num[5] == 1, m$Del_num[6] == 1, m$Depth[5] == 4, m$Depth[6] == 4)
stopifnot(m$A_num[5] == 2, sum(m[5, c("A_num", "C_num", "G_num", "T_num")]) == 2)  # 一条 N
stopifnot(m$Ins_num[5] == 1, sum(m$Ins_num) == 1)                   # 插入记在之后那一位
stopifnot(all(m$Depth[3:10] == 4), m$G_num[1] == 0)                 # secondary / supplementary 没进

# ── 与频率表逐格相等 + BAM 主源 ───────────────────────────────────────────
root <- make_package()
write_sample_bam(root, "9", AMPLICON, TARGET_INDEX0, "T", 0, depth = 50L)
write_sample_bam(root, "27", AMPLICON, TARGET_INDEX0, "T", 1, depth = 50L)
# 9 号的频率表重写成深度 50，好与 BAM 逐格比
write_sample(root, "9", AMPLICON, edited_index = TARGET_INDEX0, edited_fraction = 0, depth = 50L)
write_sample(root, "27", AMPLICON, edited_index = TARGET_INDEX0, edited_to = "T", edited_fraction = 1,
             depth = 50L, delimiter = ",")
samples <- by_slot(nano_read_package(root))
stopifnot(samples[["9"]]$source == "BAM", samples[["9"]]$data_note == "")
stopifnot(samples[["27"]]$source == "BAM", samples[["27"]]$data_note == "")
stopifnot(samples[["44"]]$source == "频率表", samples[["44"]]$data_note == "")
results <- by_slot(nano_analyse(unname(samples), guide_spec()))
stopifnot(approx(results[["27"]]$target$edited_fraction, 1), results[["27"]]$target$depth == 50)
stopifnot(approx(results[["44"]]$target$edited_fraction, 0.60))       # 反向、无 BAM 照旧

# ── 频率表截断：有 BAM 照读并记瑕疵；没 BAM 明确报截断 ─────────────────────
cut_before_target <- TARGET_INDEX0 - 5L
truncate_frequency(root, "9", cut_before_target)
truncate_frequency(root, "45", cut_before_target)
truncate_frequency(root, "44", nchar(AMPLICON) - 5L)   # 44 反向：目标位行号仍在截断之内
samples <- by_slot(nano_read_package(root))
stopifnot(nrow(nano_read_table(list.files(file.path(root, "9", "Frequency_tables"), full.names = TRUE))) ==
            cut_before_target)                                     # 半行被丢掉
stopifnot(grepl("疑似截断", samples[["9"]]$data_note), samples[["9"]]$source == "BAM")
results <- by_slot(nano_analyse(unname(samples), guide_spec()))
stopifnot(nano_readable(results[["9"]]), approx(results[["9"]]$target$edited_fraction, 0))
stopifnot(length(results[["9"]]$window) == nchar(GUIDE))                # 整个窗口都在
stopifnot(!nano_readable(results[["45"]]), grepl("被截断", results[["45"]]$skipped_reason),
          grepl("数据瑕疵", results[["45"]]$skipped_reason))
stopifnot(!grepl("读不出深度", results[["45"]]$skipped_reason))
stopifnot(nano_readable(results[["44"]]), grepl("疑似截断", results[["44"]]$data_note))
stopifnot(grepl("空文件", results[["55"]]$skipped_reason), grepl("空文件", results[["55"]]$data_note))

# ── 频率表与 BAM 不符：照用 BAM，记瑕疵 ────────────────────────────────────
write_sample(root, "27", AMPLICON, edited_index = TARGET_INDEX0, edited_to = "T", edited_fraction = 0.5,
             depth = 50L)
s27 <- by_slot(nano_read_package(root))[["27"]]
stopifnot(s27$source == "BAM", grepl("不一致（1 个位点）", s27$data_note))

# ── BAM 坏了 / 长度不符：回退频率表并说明 ─────────────────────────────────
writeBin(as.raw(1:50), file.path(root, "27", "Bam", "27.sort.bam"))
s27 <- by_slot(nano_read_package(root))[["27"]]
stopifnot(s27$source == "频率表", grepl("BAM 解析失败", s27$data_note))
write_bam(file.path(root, "27", "Bam", "27.sort.bam"), 30L, list(list(pos = 0L, cigar = "30M", seq = strrep("A", 30))))
s27 <- by_slot(nano_read_package(root))[["27"]]
stopifnot(s27$source == "频率表", grepl("不符，改用频率表", s27$data_note))

# ── 深度 0 是样本问题，不是文件坏了 ───────────────────────────────────────
zero <- file.path(tempfile("zero_"), "order_PROJ-001"); dir.create(zero, recursive = TRUE)
write_sample(zero, "1", AMPLICON, edited_index = TARGET_INDEX0, edited_fraction = 0, depth = 0L)
z <- nano_analyse(nano_read_package(zero), guide_spec())[[1]]
stopifnot(!nano_readable(z), grepl("深度 0", z$skipped_reason))

# ── nano_analyze_rows 带出每行的来源与瑕疵 ────────────────────────────────
rows <- list(list(file = "9", guide = GUIDE, target_position = 6, target_base = "C", edited_base = "T"),
             list(file = "45", guide = GUIDE, target_position = 6, target_base = "C", edited_base = "T"))
out <- nano_analyze_rows(root, rows)
stopifnot(out$sources[["9"]]$source == "BAM", grepl("截断", out$sources[["9"]]$data_note))
stopifnot(out$sources[["45"]]$source == "频率表", out$n_success == 1)
stopifnot(!any(c("Data_Source", "Data_Note") %in% names(out$summary_df)))   # summary 列不变

cat("test_nanopore_bam: ok\n")
