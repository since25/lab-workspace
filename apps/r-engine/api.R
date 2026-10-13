# api.R
# Lab Workspace 分析服务（R plumber）。
# 算法与处理函数来自 EditR_wang（提交 0ca92f0）的 R/ 目录，只保留 Sanger、纳米孔、
# 结果打包和重命名预览；归档、Hub 推送、SQLite 模板库不迁移。
# 本服务只监听本机，由 Web 层负责登录鉴权和会话归属校验。

library(plumber)
library(jsonlite)

editrversion <- "lab-workspace-1"

source("R/analysis.R")
source("R/data_processing.R")
source("R/nanopore.R")
# local = TRUE：handler 与下面的助手函数处于同一求值环境
source("R/handlers_upload.R", local = TRUE)
source("R/handlers_analyze.R", local = TRUE)
source("R/handlers_nanopore.R", local = TRUE)

# 临时工作区：上传文件与结果包只在这里，过期即删，不做归档
upload_dir <- Sys.getenv("LAB_TEMP_DIR", file.path(tempdir(), "lab_jobs"))
TEMP_JOB_TTL_HOURS <- as.numeric(Sys.getenv("TEMP_JOB_TTL_HOURS", "24"))
dir.create(upload_dir, showWarnings = FALSE, recursive = TRUE)

session_results <- new.env(parent = emptyenv())

sweep_stale_sessions <- function(root = upload_dir, ttl_hours = TEMP_JOB_TTL_HOURS) {
  if (!isTRUE(ttl_hours > 0) || !dir.exists(root)) return(invisible(0L))
  dirs <- list.dirs(root, recursive = FALSE, full.names = TRUE)
  if (length(dirs) == 0) return(invisible(0L))
  cutoff <- Sys.time() - ttl_hours * 3600
  # 按目录内最新文件时间判活
  stale <- vapply(dirs, function(d) {
    fs <- list.files(d, recursive = TRUE, full.names = TRUE)
    newest <- if (length(fs)) max(file.mtime(fs)) else file.mtime(d)
    isTRUE(newest < cutoff)
  }, logical(1))
  victims <- dirs[stale]
  for (d in victims) {
    unlink(d, recursive = TRUE, force = TRUE)
    sid <- basename(d)
    if (exists(sid, envir = session_results, inherits = FALSE)) rm(list = sid, envir = session_results)
  }
  if (length(victims)) message(sprintf("[r-engine] 清理过期任务 %d 个（保留 %g 小时）", length(victims), ttl_hours))
  invisible(length(victims))
}

# 会话 id 来自外部，只接受「时间戳_随机数」形状，防路径穿越
safe_session_id <- function(session_id) {
  sid <- as.character(session_id %||% "")
  if (!nzchar(sid) || !grepl("^[A-Za-z0-9._-]+$", sid) ||
      grepl("\\.\\.", sid) || !grepl("[A-Za-z0-9]", sid)) return("")
  sid
}

# 每小时最多扫一次
.last_sweep <- new.env(parent = emptyenv())
.last_sweep$at <- Sys.time()
maybe_sweep_sessions <- function() {
  if (difftime(Sys.time(), .last_sweep$at, units = "hours") < 1) return(invisible(FALSE))
  .last_sweep$at <- Sys.time()
  sweep_stale_sessions()
  invisible(TRUE)
}

message(sprintf("[r-engine] upload_dir = %s（保留 %g 小时）", upload_dir, TEMP_JOB_TTL_HOURS))
sweep_stale_sessions()

rename_presets <- list(
  strip_extension = list(pattern = "\\.ab1$", replacement = ""),
  strip_leading_index = list(pattern = "^[0-9]+_", replacement = ""),
  strip_tss_suffix = list(pattern = "_TSS[0-9-]+_[A-Z][0-9]{2}\\.ab1$", replacement = ""),
  keep_index_and_primer = list(pattern = "^([0-9]+_[^_]+).*$", replacement = "\\1"),
  combined_default = list(pattern = "^([^.]+\\.[^.]+)\\..*$", replacement = "\\1")
)

# 确保某个会话的结果 ZIP 已生成并返回路径（沿用 EditR 逻辑，去掉图表与分组摘要之外的归档字段）
ensure_session_zip <- function(session_id, params = NULL, grouping = NULL, frontend_charts = NULL,
                               summary_override = NULL) {
  session_id <- safe_session_id(as_scalar_chr(session_id))
  if (!nzchar(session_id)) stop("非法的 session_id")
  session_dir <- file.path(upload_dir, session_id)
  if (!dir.exists(session_dir)) stop("任务不存在或已过期")

  grouping_df <- grouping_to_df(grouping)
  group_sig <- if (is.null(grouping_df)) "" else digest_grouping(grouping_df)
  cache_sig <- paste(
    group_sig, digest_params(params), charts_cache_digest(frontend_charts),
    digest::digest(summary_override %||% list(), algo = "xxhash64"), sep = "||"
  )

  cached <- session_results[[session_id]]
  cache_prev_sig <- if (is.null(cached)) NULL else (cached$cache_sig %||% "")
  if (!is.null(cached) && !is.null(cached$zip_path) && file.exists(cached$zip_path) &&
      identical(cache_prev_sig, cache_sig)) {
    return(cached$zip_path)
  }

  if (is.null(cached) || is.null(cached$analysis)) {
    if (is.null(params)) stop("结果缓存已失效，请重新分析。")
    analysis <- run_batch_analysis(
      session_dir, params$sequence, params$target_position,
      params$target_base, params$edited_base,
      params$rename_config %||% list(), rename_presets,
      params$guide_overrides %||% list(), params$ref_sequence %||% NULL,
      params$ref_target_pos %||% NULL
    )
    cached <- list(
      analysis = analysis,
      rename_config = params$rename_config %||% list(),
      template_name = params$template_name %||% "results",
      zip_path = NULL
    )
  }

  a <- cached$analysis
  summary_df <- payload_rows_to_df(summary_override) %||% a$summary_df
  zip_path <- generate_results_zip(
    session_dir, summary_df, a$raw_df, a$errors, a$name_map,
    cached$template_name, grouping_df,
    frontend_charts = frontend_charts,
    flank_df = a$flank_df
  )
  cached$zip_path <- zip_path
  cached$cache_sig <- cache_sig
  session_results[[session_id]] <- cached
  zip_path
}

# 分组签名：覆盖分组表每一列，分组变化时让缓存的 zip 失效
digest_grouping <- function(grouping_df) {
  if (is.null(grouping_df) || nrow(grouping_df) == 0) return("")
  ordered <- grouping_df[order(grouping_df$Table_Name), , drop = FALSE]
  cols <- sort(names(ordered))
  flat <- unlist(lapply(cols, function(nm) c(nm, as.character(ordered[[nm]]))),
                 use.names = FALSE)
  digest::digest(flat, algo = "xxhash64")
}

# 请求体里的兜底分析参数（缓存失效时用）
body_params <- function(body) {
  if (is.null(body$sequence)) return(NULL)
  list(
    sequence = toupper(trimws(body$sequence)),
    target_position = as.integer(body$target_position),
    target_base = toupper(body$target_base),
    edited_base = toupper(body$edited_base),
    rename_config = body$rename_config %||% list(),
    template_name = body$template_name %||% "results"
  )
}

#* @apiTitle Lab Workspace 分析服务

#* 健康检查
#* @get /api/health
function() {
  list(status = "ok", version = editrversion,
       timestamp = format(Sys.time(), "%Y-%m-%d %H:%M:%S"))
}

#* 上传单个 .ab1 文件（二进制 body，filename 查询参数，X-Session-Id 复用会话）
#* @param filename 文件名
#* @post /api/upload/file
#* @serializer json
#* @parser octet
function(req, filename, res) {
  tryCatch({
    if (is.null(filename) || filename == "") {
      res$status <- 400
      return(list(success = FALSE, error = "请提供 filename 参数。"))
    }
    session_id <- req$headers[["x-session-id"]] %||% req$HTTP_X_SESSION_ID
    if (is.null(session_id) || session_id == "") {
      session_id <- format(Sys.time(), "%Y%m%d%H%M%S_") |> paste0(sample(1000:9999, 1))
    } else {
      session_id <- safe_session_id(session_id)
      if (!nzchar(session_id)) {
        res$status <- 400
        return(list(success = FALSE, error = "非法的 session_id"))
      }
    }
    if (!grepl("\\.ab1$", filename, ignore.case = TRUE)) {
      res$status <- 400
      return(list(success = FALSE, error = "只接受 .ab1 文件。"))
    }
    session_dir <- file.path(upload_dir, session_id)
    maybe_sweep_sessions()
    dir.create(session_dir, showWarnings = FALSE, recursive = TRUE)

    # 同名追加 _i，避免覆盖
    dest_name <- basename(filename)
    if (file.exists(file.path(session_dir, dest_name))) {
      base <- tools::file_path_sans_ext(dest_name)
      ext <- tools::file_ext(dest_name)
      i <- 1
      repeat {
        dest_name <- paste0(base, "_", i, if (nzchar(ext)) paste0(".", ext) else "")
        if (!file.exists(file.path(session_dir, dest_name))) break
        i <- i + 1
      }
    }
    body <- req$bodyRaw
    if (is.null(body) || length(body) == 0) {
      res$status <- 400
      return(list(success = FALSE, error = "未接收到文件数据。"))
    }
    writeBin(body, file.path(session_dir, dest_name))
    list(success = TRUE, session_id = session_id, filename = dest_name)
  }, error = function(e) {
    res$status <- 500
    list(success = FALSE, error = paste("上传失败：", e$message))
  })
}

#* 上传 ZIP 并提取其中的 .ab1
#* @post /api/upload/zip
#* @serializer json
#* @parser octet
function(req, res) handle_upload_zip(req, res)

#* 会话中已有的 .ab1 文件
#* @param session_id 会话 ID
#* @get /api/session/files
#* @serializer json
function(session_id, res) {
  sid <- safe_session_id(session_id %||% "")
  if (!nzchar(sid)) {
    res$status <- 400
    return(list(success = FALSE, error = "非法的 session_id"))
  }
  session_dir <- file.path(upload_dir, sid)
  if (!dir.exists(session_dir)) {
    res$status <- 404
    return(list(success = FALSE, error = "任务不存在或已过期"))
  }
  files <- list.files(session_dir, pattern = "\\.ab1$", ignore.case = TRUE)
  list(success = TRUE, session_id = sid, files = as.list(files), count = length(files))
}

#* Sanger 批量分析
#* @post /api/analyze
#* @serializer json
function(req, res) handle_analyze(req, res)

#* 纳米孔交付包上传
#* @post /api/nanopore/upload
#* @serializer json
#* @parser octet
function(req, res) handle_nanopore_upload(req, res)

#* 纳米孔会话样本清单
#* @param session_id 会话 ID
#* @get /api/nanopore/session
#* @serializer json
function(session_id, res) handle_nanopore_session(session_id, res)

#* 纳米孔分析
#* @post /api/nanopore/analyze
#* @serializer json
function(req, res) handle_nanopore_analyze(req, res)

#* 下载结果 ZIP（Excel + 重命名后的 .ab1）
#* @post /api/download/results
#* @serializer json
function(req, res) {
  tryCatch({
    body <- tryCatch(fromJSON(req$postBody, simplifyVector = FALSE), error = function(e) NULL)
    if (is.null(body) || is.null(body$session_id)) {
      res$status <- 400
      return(list(success = FALSE, error = "缺少必要参数"))
    }
    zip_path <- ensure_session_zip(body$session_id, body_params(body), body$grouping, NULL,
                                   summary_override = body$summary_override)
    if (is.null(zip_path) || !file.exists(zip_path)) {
      res$status <- 500
      return(list(success = FALSE, error = "生成结果包失败"))
    }
    bin <- readBin(zip_path, "raw", file.size(zip_path))
    res$setHeader("Content-Type", "application/zip")
    res$setHeader("Content-Disposition", paste0("attachment; filename=", basename(zip_path)))
    res$body <- bin
    res
  }, error = function(e) {
    res$status <- 500
    list(success = FALSE, error = paste("下载失败：", e$message))
  })
}

#* 立即清理某个会话
#* @param session_id 会话 ID
#* @delete /api/session
#* @serializer json
function(session_id, res) {
  sid <- safe_session_id(session_id %||% "")
  if (!nzchar(sid)) {
    res$status <- 400
    return(list(success = FALSE, error = "非法的 session_id"))
  }
  unlink(file.path(upload_dir, sid), recursive = TRUE, force = TRUE)
  if (exists(sid, envir = session_results, inherits = FALSE)) rm(list = sid, envir = session_results)
  list(success = TRUE)
}
