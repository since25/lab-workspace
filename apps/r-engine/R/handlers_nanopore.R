# R/handlers_nanopore.R
# 纳米孔那三条端点的 handler（2026-09-20，映射层波 3）。
#
# 与 `source(..., local = TRUE)` 的其它 handler 一样，直接用 api.R 顶部那些助手
# （upload_dir / safe_session_id / maybe_sweep_sessions / session_results / as_scalar_chr）。
#
# 会话目录里纳米孔的东西全放在 `<session>/nanopore/` 下，与 Sanger 的 .ab1 平铺
# 互不打扰：同一个会话不会两种都有（Hub 一次派发只有一种），但目录分开之后
# `list.files(pattern = "\\.ab1$")` 那些老代码一个都不用改。

NANO_SESSION_SUBDIR <- "nanopore"

nano_session_root <- function(session_dir) {
  nano_package_root(file.path(session_dir, NANO_SESSION_SUBDIR))
}

# 会话里有哪几个样本目录（有 Sequences/ 的才算）。
nano_session_slots <- function(session_dir) {
  root <- nano_session_root(session_dir)
  if (!dir.exists(root)) return(character(0))
  dirs <- list.dirs(root, recursive = FALSE, full.names = FALSE)
  dirs <- dirs[vapply(dirs, function(d) dir.exists(file.path(root, d, NANO_SEQ_DIR)), logical(1))]
  nano_sort_slots(dirs)
}

# POST /api/nanopore/upload —— 收一个 zip，**保留目录结构**解到会话目录下。
#
# 与 /api/upload/zip 的差别：那条会把包扁平化、只认 .ab1；纳米孔要的正是目录结构
# （目录名就是样本号，三类文件按子目录认）。Hub 只送解析要用的三类文件，几 MB。
# 回报收到内容的 sha256：Hub 送之前算过一遍，两边一对就是**双向**核对。
handle_nanopore_upload <- function(req, res) {
  session_id <- req$headers[["x-session-id"]] %||% req$HTTP_X_SESSION_ID %||% ""
  if (!nzchar(session_id)) {
    session_id <- paste0("session_", format(Sys.time(), "%Y%m%d%H%M%S"), "_", sample(1000:9999, 1))
  }
  session_id <- safe_session_id(session_id)
  if (!nzchar(session_id)) {
    res$status <- 400
    return(list(success = FALSE, error = "非法的 session_id"))
  }
  session_dir <- file.path(upload_dir, session_id)
  maybe_sweep_sessions()
  dest <- file.path(session_dir, NANO_SESSION_SUBDIR)
  dir.create(dest, recursive = TRUE, showWarnings = FALSE)

  zip_data <- req$bodyRaw
  if (is.null(zip_data) || length(zip_data) == 0) {
    res$status <- 400
    return(list(success = FALSE, error = "未收到 ZIP 文件数据"))
  }
  zip_path <- tempfile("nanopore_", tmpdir = session_dir, fileext = ".zip")
  on.exit(unlink(zip_path, force = TRUE), add = TRUE)
  writeBin(zip_data, zip_path)
  sha <- digest::digest(zip_data, algo = "sha256", serialize = FALSE)

  entries <- tryCatch(utils::unzip(zip_path, list = TRUE)$Name, error = function(e) NULL)
  if (is.null(entries)) {
    res$status <- 400
    return(list(success = FALSE, error = "ZIP 文件解压失败，可能文件已损坏"))
  }
  # 包内路径不许往上爬：解到会话目录之外就是越界。
  if (any(grepl("(^|/)\\.\\.(/|$)", entries) | startsWith(entries, "/"))) {
    res$status <- 400
    return(list(success = FALSE, error = "ZIP 里有越界路径，拒绝解压"))
  }
  # lab-workspace：用户直接传整个厂商交付包，只解分析要用的文件，fastq / QC / .bai 等不落盘。
  # Bam/*.bam 是逐位点读值的主源（2026-10-13，见 docs/nanopore-data-source.md），每管约 100 KB。
  wanted <- entries[grepl(sprintf("(^|/)(%s|%s|%s)/[^/]+$", NANO_SEQ_DIR, NANO_FREQ_DIR, NANO_SUS_DIR), entries) |
                      grepl(sprintf("(^|/)%s/[^/]+\\.bam$", NANO_BAM_DIR), entries)]
  if (length(wanted) == 0) {
    res$status <- 400
    return(list(success = FALSE,
                error = sprintf("ZIP 里没有认得出的样本目录（每个样本要有 %s/*.fasta）", NANO_SEQ_DIR)))
  }
  ok <- tryCatch({ utils::unzip(zip_path, files = wanted, exdir = dest); TRUE }, error = function(e) FALSE)
  if (!ok) {
    res$status <- 400
    return(list(success = FALSE, error = "ZIP 文件解压失败，可能文件已损坏"))
  }
  slots <- nano_session_slots(session_dir)
  if (length(slots) == 0) {
    res$status <- 400
    return(list(success = FALSE,
                error = sprintf("ZIP 里没有认得出的样本目录（每个样本要有 %s/*.fasta）", NANO_SEQ_DIR)))
  }
  list(success = TRUE, session_id = session_id, samples = as.list(slots),
       n_samples = length(slots), sha256 = sha)
}

# GET /api/nanopore/session?session_id= —— 会话里的样本目录清单。
# 供 Hub 派发后前端接管会话时恢复表格（与 /api/session/files 对 .ab1 的作用相同）。
handle_nanopore_session <- function(session_id, res) {
  sid <- safe_session_id(session_id %||% "")
  if (!nzchar(sid)) {
    res$status <- 400
    return(list(success = FALSE, error = "缺少或非法的 session_id"))
  }
  session_dir <- file.path(upload_dir, sid)
  if (!dir.exists(session_dir)) {
    res$status <- 404
    return(list(success = FALSE, error = "会话不存在或已过期"))
  }
  slots <- nano_session_slots(session_dir)
  list(success = TRUE, session_id = sid, samples = as.list(slots), n_samples = length(slots))
}

# POST /api/nanopore/analyze —— body {session_id, rows, template_name}
# rows 就是派发参数那份（人核对后的）：每行 file = 样本目录号，detections[] 各带
# target / guide / target_position / bystander_position / target_base / edited_base。
handle_nanopore_analyze <- function(req, res) {
  tryCatch({
    body <- fromJSON(req$postBody, simplifyVector = FALSE)
    session_id <- safe_session_id(as_scalar_chr(body$session_id) %||% "")
    if (!nzchar(session_id)) {
      res$status <- 400
      return(list(success = FALSE, error = "缺少或非法的 session_id"))
    }
    session_dir <- file.path(upload_dir, session_id)
    if (!dir.exists(session_dir)) {
      res$status <- 404
      return(list(success = FALSE, error = "未找到上传会话，请先把交付包传进会话。"))
    }
    rows <- body$rows %||% list()
    if (!is.list(rows) || length(rows) == 0 || !is.null(names(rows))) {
      res$status <- 400
      return(list(success = FALSE, error = "rows 必须是非空数组：每行一个样本目录，带它要测的检测"))
    }
    root <- nano_session_root(session_dir)
    if (!dir.exists(root)) {
      res$status <- 404
      return(list(success = FALSE, error = "这个会话里没有纳米孔交付包"))
    }
    template_name <- as_scalar_chr(body$template_name) %||% "nanopore"

    analysis <- nano_analyze_rows(root, rows)
    # lab-workspace 没有对外契约，读值来源与数据瑕疵直接作为两列放进 summary（页面与下载的 Excel 都看得到）。
    if (nrow(analysis$summary_df) > 0) {
      info <- lapply(analysis$summary_df$Table_Name, function(tn) analysis$sources[[tn]] %||% list())
      analysis$summary_df$Data_Source <- vapply(info, function(x) x$source %||% "", character(1))
      analysis$summary_df$Data_Note <- vapply(info, function(x) x$data_note %||% "", character(1))
    }
    if (nrow(analysis$summary_df) == 0) {
      res$status <- 422
      return(list(success = FALSE, error = "所有样本都没读出来。", errors = analysis$errors))
    }

    # 缓存进会话：下载结果包、归档、推回 Hub 都从这里取，不重算。
    session_results[[session_id]] <- list(
      analysis = analysis,
      kind = "nanopore",
      nanopore_rows = rows,
      rename_config = list(),
      template_name = template_name,
      guide_overrides = list(),
      ref_sequence = NULL,
      zip_path = NULL
    )

    list(
      success = TRUE,
      data = list(
        summary = analysis$summary_df,
        per_position = list(),
        heatmap = analysis$heatmap_df,
        raw = analysis$raw_df,
        n_files = analysis$n_files,
        n_success = analysis$n_success,
        processing_mode = analysis$processing_mode,
        elapsed_seconds = analysis$elapsed_seconds,
        errors = analysis$errors,
        # Table_Name → 样本目录号。空时 list() → []。
        name_map = lapply(names(analysis$name_map), function(tn) {
          list(original_name = analysis$name_map[[tn]], table_name = tn)
        })
      )
    )
  }, error = function(e) {
    res$status <- 500
    list(success = FALSE, error = paste("纳米孔分析失败：", e$message))
  })
}
