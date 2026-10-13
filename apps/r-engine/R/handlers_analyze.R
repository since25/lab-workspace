# R/handlers_analyze.R
# /api/analyze 端点 handler（从 api.R 抽出，逻辑逐字不变）。
handle_analyze <- function(req, res) {
  tryCatch({
    body <- fromJSON(req$postBody, simplifyVector = FALSE)
    session_id <- as_scalar_chr(body$session_id)
    sequence <- toupper(trimws(body$sequence))
    target_position <- as.integer(body$target_position)
    target_base <- toupper(body$target_base)
    edited_base <- toupper(body$edited_base)
    # 重命名配置在分析时就锁定，前置应用到整条流水线
    rename_config <- if (!is.null(body$rename_config)) body$rename_config else list()
    template_name <- if (!is.null(body$template_name)) body$template_name else "results"
    # guide_overrides: list of {file, guide, target_position?, bystander_position?,
    #                            target_base?, edited_base?}
    # 按原始文件名匹配（回退 table_name）。target_position / bystander_position 都是
    # guide 相对 1-based；旁观位由 Hub 逐支人工填写，没给就是没有、不回退任何默认位。
    # 碱基只留格子，整批须一致，由 validate_guide_overrides 拦。
    guide_overrides <- if (!is.null(body$guide_overrides) && is.list(body$guide_overrides)) body$guide_overrides else list()
    # ref_sequence: 可选参考序列片段，用于把 guide.position 转成绝对参考坐标
    ref_sequence <- if (!is.null(body$ref_sequence) && nchar(body$ref_sequence) > 0) toupper(trimws(body$ref_sequence)) else NULL
    # ref_target_pos: 可选参比绝对 1-based 目标位（用户点选），优先于 guide 相对映射
    ref_target_pos <- if (!is.null(body$ref_target_pos)) as.integer(body$ref_target_pos) else NULL
    # file_ids: [{file: storedName, id}] - 前端稳定行 id,用于把结果按 id 关联(名字仅作 label)
    file_ids <- if (!is.null(body$file_ids) && is.list(body$file_ids)) body$file_ids else NULL

    if (!grepl("^[ACGT]+$", sequence)) {
      res$status <- 400
      return(list(success = FALSE, error = "序列仅支持 A/C/G/T 字符。"))
    }
    if (target_base == edited_base) {
      res$status <- 400
      return(list(success = FALSE, error = "目标碱基和编辑后碱基不能相同。"))
    }
    if (target_position < 1 || target_position > nchar(sequence)) {
      res$status <- 400
      return(list(success = FALSE, error = "目标位置超出序列长度。"))
    }

    # per-file 分析参数校验。碱基只留格子不做逐样品分方向，整批必须一致；
    # 目标位必须落在该行 guide 内。错在这里就止住，别跑完一趟再报。
    ov_err <- validate_guide_overrides(guide_overrides, target_base, edited_base, sequence)
    if (!is.null(ov_err)) {
      res$status <- 400
      return(list(success = FALSE, error = ov_err))
    }

    # 查找会话目录。session_id 来自 body，外部可控
    session_id <- safe_session_id(session_id)
    if (!nzchar(session_id)) {
      res$status <- 400
      return(list(success = FALSE, error = "非法的 session_id"))
    }
    session_dir <- file.path(upload_dir, session_id)
    if (!dir.exists(session_dir)) {
      res$status <- 404
      return(list(success = FALSE, error = "未找到上传会话，请先上传文件。"))
    }

    analysis <- tryCatch(
      run_batch_analysis(session_dir, sequence, target_position,
                         target_base, edited_base, rename_config, rename_presets,
                         guide_overrides, ref_sequence, ref_target_pos),
      error = function(e) {
        if (inherits(e, "editr_all_failed")) {
          structure(list(all_failed = TRUE, errors = e$errors), class = "editr_failed_result")
        } else {
          stop(e)
        }
      }
    )

    if (inherits(analysis, "editr_failed_result")) {
      res$status <- 422
      return(list(success = FALSE, error = "所有文件分析失败。", errors = analysis$errors))
    }

    # 缓存分析结果，供 /api/results/prepare 与下载复用（不必重新分析）
    session_results[[session_id]] <- list(
      analysis = analysis,
      rename_config = rename_config,
      template_name = template_name,
      guide_overrides = guide_overrides,
      ref_sequence = ref_sequence,
      zip_path = NULL
    )

    list(
      success = TRUE,
      data = list(
        summary = analysis$summary_df,
        per_position = analysis$display_df,
        heatmap = analysis$heatmap_df,
        signals = analysis$signal_df,
        # guide 上下游各 50 位读值（多序列页「上下游扫一眼」用）；没有时是 null
        flank = analysis$flank_df,
        raw = analysis$raw_df,
        n_files = analysis$n_files,
        n_success = analysis$n_success,
        processing_mode = analysis$processing_mode,
        elapsed_seconds = analysis$elapsed_seconds,
        # 始终返回数组：空时为 []（而非 NULL，否则 jsonlite 会序列化成 {}，
        # 前端读到的 errors.length 变成 undefined，弹出"（空）个文件分析失败"）
        errors = analysis$errors,
        # 命名映射数组：原始文件名 -> 重命名后 Table_Name,并附前端 file_ids 的 id。
        # 空时 list() → []；非空为 {id, original_name, table_name} 对象数组(id 缺为 null)。
        name_map = build_name_map_payload(analysis$name_map, file_ids)
      )
    )
  }, error = function(e) {
    res$status <- 500
    list(success = FALSE, error = paste("分析失败：", e$message))
  })
}
