# 生成重命名对照数据，供网页端 rename.test.ts 校验前端预览与 R 结果一致（文件名均为虚构）
# 用法：在 apps/r-engine 目录下 Rscript tests/make_rename_fixture.R <输出 json>
suppressMessages({ library(jsonlite); source("R/data_processing.R", encoding = "UTF-8") })
`%||%` <- function(x, y) if (is.null(x) || length(x) == 0) y else x
rename_presets <- list(
  strip_extension = list(pattern = "\\.ab1$", replacement = ""),
  strip_leading_index = list(pattern = "^[0-9]+_", replacement = ""),
  strip_tss_suffix = list(pattern = "_TSS[0-9-]+_[A-Z][0-9]{2}\\.ab1$", replacement = ""),
  keep_index_and_primer = list(pattern = "^([0-9]+_[^_]+).*$", replacement = "\\1"),
  combined_default = list(pattern = "^([^.]+\\.[^.]+)\\..*$", replacement = "\\1")
)
names <- c("R1-9.IDUAR.3380632.G05100E04.H03.ab1", "R1-9.IDUAR.3380632.G06.H04.ab1", "12_P1_SAMPLE_A.ab1",
           "12_P1_SAMPLE_B.AB1", "3_P2_x_TSS1-2_A01.ab1", "样品甲_wt.ab1", "a.b.ab1", "plain.ab1", "plain_1.ab1", "Zeta.ab1", "alpha.ab1")
cases <- list(
  list(preset = "", pattern = "", replacement = "", tag = ""),
  list(preset = "combined_default", tag = ""),
  list(preset = "strip_leading_index", tag = "批次 1"),
  list(preset = "keep_index_and_primer", tag = "run-2"),
  list(preset = "strip_tss_suffix", tag = ""),
  list(preset = "custom", pattern = "_(SAMPLE|wt)", replacement = "-\\1", tag = "")
)
out <- lapply(cases, function(cs) {
  nm <- compute_rename_map(names, cs, rename_presets)
  c(cs, list(names = names, expected = unname(nm[names])))
})
writeLines(toJSON(out, auto_unbox = TRUE, pretty = TRUE), commandArgs(TRUE)[1], useBytes = TRUE)
cat("ok\n")
