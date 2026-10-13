# R/handlers_upload.R
# /api/upload/zip 端点 handler。支持同一 session 连续追加多个 ZIP。
handle_upload_zip <- function(req, res) {
  session_id <- req$headers[["x-session-id"]] %||%
                req$headers[["X-Session-Id"]] %||%
                req$HTTP_X_SESSION_ID
  if (is.null(session_id) || session_id == "") {
    session_id <- paste0("session_", format(Sys.time(), "%Y%m%d%H%M%S"), "_", sample(1000:9999, 1))
  }

  # session_id 来自 X-Session-Id 头，外部可控
  session_id <- safe_session_id(session_id)
  if (!nzchar(session_id)) {
    res$status <- 400
    return(list(success = FALSE, error = "非法的 session_id"))
  }
  session_dir <- file.path(upload_dir, session_id)
  maybe_sweep_sessions()   # 会话目录现在是持久的，得有人定期扫
  dir.create(session_dir, recursive = TRUE, showWarnings = FALSE)

  # 读取请求体
  zip_data <- req$bodyRaw
  if (is.null(zip_data) || length(zip_data) == 0) {
    res$status <- 400
    return(list(success = FALSE, error = "未收到 ZIP 文件数据"))
  }

  # 每次请求使用独立临时 ZIP 和解压目录，避免后续追加 ZIP 时重新扫描上一次残留。
  zip_path <- tempfile("upload_", tmpdir = session_dir, fileext = ".zip")
  extract_dir <- tempfile("zip_extracted_", tmpdir = session_dir)
  dir.create(extract_dir, recursive = TRUE, showWarnings = FALSE)
  on.exit(unlink(c(zip_path, extract_dir), recursive = TRUE, force = TRUE), add = TRUE)
  writeBin(zip_data, zip_path)

  extracted_files <- tryCatch({
    unzip(zip_path, exdir = extract_dir)
  }, error = function(e) {
    NULL
  })

  if (is.null(extracted_files)) {
    res$status <- 400
    return(list(success = FALSE, error = "ZIP 文件解压失败，可能文件已损坏"))
  }

  # 查找所有 .ab1 文件
  ab1_files <- list.files(extract_dir, pattern = "\\.ab1$", recursive = TRUE, ignore.case = TRUE, full.names = TRUE)

  if (length(ab1_files) == 0) {
    res$status <- 400
    return(list(success = FALSE, error = "ZIP 中未找到 .ab1 文件"))
  }

  # 复制 .ab1 到 session 目录根（扁平化）。与当前会话已有文件重名时，
  # 按 base_1、base_2... 递增，不能用包内下标，否则多次追加时可能再次撞名。
  copied_names <- character(length(ab1_files))
  for (i in seq_along(ab1_files)) {
    fname <- basename(ab1_files[i])
    base <- tools::file_path_sans_ext(fname)
    ext <- paste0(".", tools::file_ext(fname))
    dest_name <- fname
    suffix <- 1L
    while (file.exists(file.path(session_dir, dest_name))) {
      dest_name <- paste0(base, "_", suffix, ext)
      suffix <- suffix + 1L
    }
    copied <- file.copy(ab1_files[i], file.path(session_dir, dest_name), overwrite = FALSE)
    if (!isTRUE(copied)) stop(paste0("无法保存解压文件: ", fname))
    copied_names[i] <- dest_name
  }

  # 记录非 .ab1 文件
  all_extracted <- list.files(extract_dir, recursive = TRUE)
  skipped <- setdiff(all_extracted, basename(ab1_files))

  list(
    success = TRUE,
    session_id = session_id,
    extracted_files = copied_names,
    all_files = list.files(session_dir, pattern = "\\.ab1$", ignore.case = TRUE, full.names = FALSE),
    total_extracted = length(copied_names),
    skipped_files = skipped
  )
}
