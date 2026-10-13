# 纳米孔上传与分析（lab-workspace）：整包上传时只解出分析要用的文件（含 Bam/*.bam），分析正常进缓存。
# 数据全部由 fixtures/nanopore_synth.R 合成，不含真实样本。
# 用法：在 apps/r-engine 目录下 Rscript tests/test_nanopore_upload.R
suppressMessages({ library(jsonlite); source("R/data_processing.R"); source("R/nanopore.R") })
source("tests/fixtures/nanopore_synth.R")

upload_dir <- tempfile("nano_sessions_")
dir.create(upload_dir, recursive = TRUE)
maybe_sweep_sessions <- function() invisible(FALSE)
safe_session_id <- function(x) {
  x <- as.character(x %||% "")
  if (length(x) == 1 && grepl("^[A-Za-z0-9._-]+$", x)) x else ""
}
as_scalar_chr <- function(x) { if (is.null(x)) NULL else as.character(x)[1] }
session_results <- new.env(parent = emptyenv())
source("R/handlers_nanopore.R")

# 模拟厂商整包：三类文件之外再放 Bam（9 号是坏的 BAM、27 号是好的）、.bai、fastq 和根目录文件
root <- make_package()
dir.create(file.path(root, "9", "Bam"))
writeBin(as.raw(1:100), file.path(root, "9", "Bam", "9.bam"))
writeBin(as.raw(1:96), file.path(root, "9", "Bam", "9.bam.bai"))
dir.create(file.path(root, "9", "fastq"))
writeLines("@r1", file.path(root, "9", "fastq", "9.fastq"))
write_sample_bam(root, "27", AMPLICON, TARGET_INDEX0, "T", 1, depth = 20L)
writeLines("qc", file.path(root, "QC_report.txt"))
zip_path <- tempfile(fileext = ".zip")
old <- setwd(dirname(root)); create_zip_archive(zip_path, basename(root), recurse = TRUE); setwd(old)

req <- list(headers = list("x-session-id" = "N1"), bodyRaw = readBin(zip_path, "raw", file.info(zip_path)$size))
res <- new.env(); res$status <- 200L
up <- handle_nanopore_upload(req, res)
stopifnot(isTRUE(up$success), up$n_samples == 5)
extracted <- list.files(file.path(upload_dir, "N1"), recursive = TRUE)
stopifnot(!any(grepl("\\.bai$|fastq|QC_report", extracted)))
stopifnot(any(grepl("9/Bam/9\\.bam$", extracted)), any(grepl("27/Bam/27\\.sort\\.bam$", extracted)))
stopifnot(any(grepl("/Sequences/", extracted)), any(grepl("/Frequency_tables/", extracted)))

# 不含样本目录的 zip 拒绝
bad_dir <- tempfile("bad_"); dir.create(bad_dir); writeLines("x", file.path(bad_dir, "a.txt"))
bad_zip <- tempfile(fileext = ".zip")
old <- setwd(bad_dir); create_zip_archive(bad_zip, "a.txt"); setwd(old)
res <- new.env(); res$status <- 200L
bad <- handle_nanopore_upload(list(headers = list("x-session-id" = "N2"), bodyRaw = readBin(bad_zip, "raw", file.info(bad_zip)$size)), res)
stopifnot(res$status == 400, isFALSE(bad$success))

# 分析
rows <- list(list(file = "9", guide = GUIDE, target_position = 6, target_base = "C", edited_base = "T"),
             list(file = "27", guide = GUIDE, target_position = 6, target_base = "C", edited_base = "T"),
             list(file = "44", guide = GUIDE, target_position = 6, target_base = "C", edited_base = "T"))
res <- new.env(); res$status <- 200L
an <- handle_nanopore_analyze(list(postBody = toJSON(list(session_id = "N1", rows = rows), auto_unbox = TRUE)), res)
stopifnot(res$status == 200, isTRUE(an$success), an$data$n_success == 3)
sm <- an$data$summary
stopifnot(identical(sm$Data_Source, c("频率表", "BAM", "频率表")))
stopifnot(grepl("BAM 解析失败", sm$Data_Note[1]), grepl("与 BAM 计数不一致", sm$Data_Note[2]), sm$Data_Note[3] == "")
stopifnot(identical(session_results[["N1"]]$analysis$summary_df$Data_Source, sm$Data_Source))  # 下载的 Excel 也带
stopifnot(identical(session_results[["N1"]]$kind, "nanopore"))

unlink(upload_dir, recursive = TRUE, force = TRUE)
cat("test_nanopore_upload: ok\n")
