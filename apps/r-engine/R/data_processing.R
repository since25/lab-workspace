# R/data_processing.R
# 数据处理和可视化函数 - 从 server.R 提取

# `%||%` 是 R 4.4.0 才加入 base 的，旧 R（如服务器曾用的 4.3.3）没有。
# 本模块多处用到，这里自带守卫定义，保证在任何 R 版本下都可用。
if (!exists("%||%", mode = "function")) {
  `%||%` <- function(x, y) if (is.null(x) || length(x) == 0) y else x
}

#' 文件名自然序排序
#'
#' list.files 给的是字典序，送样编号那种多段数字会排成 G1-1-1, G1-1-10, G1-1-2。
#' 分析就是按这个顺序跑的，于是 Excel 摘要、归档和推出去的行序全是乱的。这里把每段
#' 数字左补零到等宽后再按 C 序排，等价于「按数值比较每一段」，与前端指派表口径一致。
#' 大小写不参与比较；补零只用于排序键，不改动返回的原字符串。
sort_natural <- function(x) {
  if (length(x) == 0) return(x)
  key <- vapply(tolower(x), function(s) {
    nums <- regmatches(s, gregexpr("[0-9]+", s))[[1]]
    if (length(nums) > 0) {
      padded <- vapply(nums, function(n) paste0(strrep("0", max(0, 20 - nchar(n))), n), character(1))
      regmatches(s, gregexpr("[0-9]+", s)) <- list(padded)
    }
    s
  }, character(1), USE.NAMES = FALSE)
  x[order(key, method = "radix")]
}

#' 把 name_map(storedName -> Table_Name 命名向量)序列化为带前端 id 的对象数组。
#' file_ids: list(list(file=storedName, id=number), ...) 或 NULL。
#' id 按 original_name(=storedName)对应;缺失为 NULL。响应专用,不入导出/归档。
build_name_map_payload <- function(nm, file_ids = NULL) {
  if (is.null(nm) || length(nm) == 0) return(list())
  id_by_file <- new.env(parent = emptyenv())
  if (!is.null(file_ids)) {
    for (fi in file_ids) {
      f <- fi$file
      if (!is.null(f) && nzchar(as.character(f))) {
        assign(as.character(f), fi$id, envir = id_by_file)
      }
    }
  }
  lapply(seq_along(nm), function(i) {
    on <- names(nm)[i]
    idv <- if (!is.null(on) && exists(on, envir = id_by_file, inherits = FALSE)) {
      get(on, envir = id_by_file, inherits = FALSE)
    } else {
      NULL
    }
    list(id = idv, original_name = on, table_name = unname(nm[i]))
  })
}

#' 计算原始文件名 -> 重命名后的「干净」显示名 的映射
#'
#' 这是重命名的唯一真实来源：分析阶段就用它把 Table_Name 设为重命名后的名字，
#' 让网页结果、图表、Excel 摘要全部自然使用重命名后的名字。返回的名字不含
#' 扩展名、不含 _success/_failed 状态后缀（状态后缀只用于物理 .ab1 文件）。
#' @param file_names 原始文件名向量（含 .ab1）
#' @param rename_config list(pattern, replacement, tag, preset)
#' @param rename_presets 内置预设（named list of list(pattern, replacement)）
#' @return named character：names 为原始文件名，值为重命名后的干净显示名
compute_rename_map <- function(file_names, rename_config = list(), rename_presets = NULL) {
  pattern <- rename_config$pattern %||% ""
  replacement <- rename_config$replacement %||% ""
  tag <- rename_config$tag %||% ""
  preset_id <- rename_config$preset %||% ""

  # 内置预设：用预设的 pattern/replacement 覆盖
  if (preset_id != "" && preset_id != "custom" && !is.null(rename_presets)) {
    preset_match <- rename_presets[[preset_id]]
    if (!is.null(preset_match)) {
      pattern <- preset_match$pattern
      replacement <- preset_match$replacement
    }
  }

  # 对输入按文件名规范排序后再 make.unique，使去重结果与输入顺序无关，
  # 然后映射回输入顺序。
  ord <- order(file_names)
  fn_s <- file_names[ord]
  if (pattern != "") {
    bases_s <- tryCatch(
      apply_filename_rule(fn_s, pattern, replacement),
      error = function(e) fn_s
    )
  } else {
    bases_s <- fn_s
  }

  # 只去掉 AB1 扩展名，保留重命名结果中的其他点号（例如 R1-9.IDUAR）。
  bases_s <- sub("\\.ab1$", "", bases_s, ignore.case = TRUE)
  bases_s <- make.unique(bases_s, sep = "_dup")
  tag <- normalize_tag(tag)
  if (tag != "") {
    bases_s <- paste0(bases_s, "_", tag)
  }
  bases <- character(length(file_names))
  bases[ord] <- bases_s
  stats::setNames(bases, file_names)
}

#' 构建热图数据
#' @param raw_results 原始结果数据框
#' @return long format data.frame for heatmap
build_heatmap_data <- function(raw_results) {
  if (is.null(raw_results) || nrow(raw_results) == 0) {
    return(data.frame(
      Table_Name = character(),
      Position = integer(),
      Edit_Rate = numeric(),
      stringsAsFactors = FALSE
    ))
  }

  edit_rate_cols <- names(raw_results)[grepl("^N[0-9]+_edit_rate$", names(raw_results))]
  if (length(edit_rate_cols) == 0) {
    return(data.frame(
      Table_Name = character(),
      Position = integer(),
      Edit_Rate = numeric(),
      stringsAsFactors = FALSE
    ))
  }

  heatmap_rows <- vector("list", length(edit_rate_cols))
  for (i in seq_along(edit_rate_cols)) {
    column_name <- edit_rate_cols[i]
    position_value <- suppressWarnings(as.integer(sub("^N([0-9]+)_edit_rate$", "\\1", column_name)))
    target_base_value <- if ("Target_Base" %in% names(raw_results)) {
      as.character(raw_results$Target_Base)
    } else {
      rep("", nrow(raw_results))
    }
    heatmap_rows[[i]] <- data.frame(
      Table_Name = raw_results$Table_Name,
      Position = position_value,
      Position_Label = paste0(target_base_value, position_value),
      Edit_Rate = suppressWarnings(as.numeric(raw_results[[column_name]])),
      stringsAsFactors = FALSE
    )
  }

  heatmap_df <- do.call(rbind, heatmap_rows)
  heatmap_df <- heatmap_df[!is.na(heatmap_df$Position) & !is.na(heatmap_df$Edit_Rate), , drop = FALSE]
  heatmap_df
}

#' 多条 guide 中目标碱基的 1-based 位置并集（升序去重）
#' @param guides character 列表/向量
#' @param target_base 单字符
#' @return integer 向量
union_target_positions <- function(guides, target_base) {
  if (length(guides) == 0) return(integer(0))
  idx <- unlist(lapply(guides, function(g) {
    chars <- strsplit(as.character(g), "")[[1]]
    which(chars == target_base)
  }))
  if (is.null(idx)) return(integer(0))
  sort(unique(as.integer(idx)))
}

#' 四舍五入数值列
#' @param df 数据框
#' @param digits 小数位数
#' @return data.frame
round_numeric_columns <- function(df, digits = 0) {
  if (is.null(df) || nrow(df) == 0) {
    return(df)
  }
  numeric_cols <- vapply(df, is.numeric, logical(1))
  df[numeric_cols] <- lapply(df[numeric_cols], function(x) round(x, digits = digits))
  df
}

#' 构建位点编辑率结果
#' @param raw_results 原始结果数据框
#' @param digits 小数位数
#' @return data.frame
build_position_rate_results <- function(raw_results, digits = 0) {
  if (is.null(raw_results) || nrow(raw_results) == 0) {
    return(raw_results)
  }
  edit_rate_cols <- names(raw_results)[grepl("^N[0-9]+_edit_rate$", names(raw_results))]
  if (length(edit_rate_cols) == 0) {
    return(data.frame(Table_Name = raw_results$Table_Name, stringsAsFactors = FALSE))
  }

  target_base_value <- ""
  if ("Target_Base" %in% names(raw_results) && nrow(raw_results) > 0) {
    target_base_value <- as.character(raw_results$Target_Base[1])
  }
  renamed_cols <- vapply(
    edit_rate_cols,
    function(col_name) {
      position_value <- sub("^N([0-9]+)_edit_rate$", "\\1", col_name)
      paste0(target_base_value, position_value)
    },
    character(1)
  )

  rate_df <- raw_results[, c("Table_Name", edit_rate_cols), drop = FALSE]
  names(rate_df) <- c("Table_Name", renamed_cols)
  round_numeric_columns(rate_df, digits = digits)
}

#' 构建展示结果
#' @param raw_results 原始结果数据框
#' @return data.frame
build_display_results <- function(raw_results) {
  if (is.null(raw_results) || nrow(raw_results) == 0) {
    return(raw_results)
  }
  keep_cols <- c("Table_Name", "Target_Base", "Edited_Base")
  dynamic_cols <- names(raw_results)[grepl(
    "(_ref|_edit|_edit_rate|_non_target_edit_rate)$",
    names(raw_results)
  )]
  keep_cols <- intersect(c(keep_cols, dynamic_cols), names(raw_results))
  display_df <- raw_results[, keep_cols, drop = FALSE]
  round_numeric_columns(display_df, digits = 0)
}

#' 读某一位上的四碱基占比
#'
#' 2026-09-21 起 summary 的目标位那一段**直接摆 ACGT 四个数**，不再摆「总非参比 /
#' 非预期替换」这两个由它们算出来的汇总值——两者表达的是同一件事，而四个数一眼能读，
#' 汇总值要人在脑子里反推「这 3% 到底变成了什么」。口径关系（读的人可以自己验）：
#'   总非参比   = 100 - 参比碱基那一格
#'   非预期替换 = 另外两格之和（既不是参比、也不是预期产物的那两个）
#' 宽表里这四列就是 `N<位>_A/_C/_G/_T`（`run_batch_analysis` 逐文件写入）。
#'
#' @param raw_results 原始结果数据框
#' @param row_index 样品行号
#' @param position 位点编号
#' @return 命名数值向量 c(A=, C=, G=, T=)；该列不在结果表里时那一项为 NA（不填 0）
read_position_base_rates <- function(raw_results, row_index, position) {
  vapply(c("A", "C", "G", "T"), function(base) {
    column <- paste0("N", position, "_", base)
    if (!(column %in% names(raw_results))) return(NA_real_)
    suppressWarnings(as.numeric(raw_results[[column]][row_index]))
  }, numeric(1))
}

#' 计算单个位点的编辑质量指标
#' @param raw_results 原始结果数据框
#' @param row_index 样品行号
#' @param position 位点编号
#' @param target_base 原始目标碱基
#' @param edited_base 预期编辑后碱基
#' @return list(total_non_reference, unintended_substitution, product_purity)
calculate_position_quality_metrics <- function(raw_results, row_index, position,
                                               target_base, edited_base) {
  result <- list(
    total_non_reference = NA_real_,
    unintended_substitution = NA_real_,
    product_purity = NA_real_
  )
  prefix <- paste0("N", position)
  ref_col <- paste0(prefix, "_", target_base, "_ref")
  edit_col <- paste0(prefix, "_edit_rate")
  other_bases <- setdiff(c("A", "C", "G", "T"), c(target_base, edited_base))
  other_cols <- paste0(prefix, "_", other_bases)

  if (!(ref_col %in% names(raw_results))) {
    return(result)
  }
  ref_value <- suppressWarnings(as.numeric(raw_results[[ref_col]][row_index]))
  if (is.na(ref_value)) {
    return(result)
  }
  result$total_non_reference <- 100 - ref_value

  if (all(other_cols %in% names(raw_results))) {
    other_values <- suppressWarnings(as.numeric(
      raw_results[row_index, other_cols, drop = TRUE]
    ))
    if (!any(is.na(other_values))) {
      result$unintended_substitution <- sum(other_values)
    }
  }

  if (!(edit_col %in% names(raw_results)) ||
      is.na(result$unintended_substitution) ||
      result$total_non_reference <= 0) {
    return(result)
  }
  edit_value <- suppressWarnings(as.numeric(raw_results[[edit_col]][row_index]))
  if (!is.na(edit_value)) {
    result$product_purity <- edit_value / result$total_non_reference * 100
  }
  result
}

#' 构建摘要结果
#' @param raw_results 原始结果数据框
#' @param target_position_value 目标位置值
#' @return data.frame
build_summary_results <- function(raw_results, target_position_value) {
  if (is.null(raw_results) || nrow(raw_results) == 0) {
    return(raw_results)
  }
  edit_rate_cols <- names(raw_results)[grepl("^N[0-9]+_edit_rate$", names(raw_results))]
  if (length(edit_rate_cols) == 0) {
    return(data.frame(
      Table_Name = raw_results$Table_Name,
      Target_Base = raw_results$Target_Base,
      Edited_Base = raw_results$Edited_Base,
      stringsAsFactors = FALSE
    ))
  }

  # per-file 目标位（Task 5 由 process_single_file 随行写入）。列不存在或某行为
  # NA 时回退顶层单值——不带 per-file 参数的旧调用行为逐字不变。
  has_row_pos <- "Target_Position_N" %in% names(raw_results)
  pos_vec <- vapply(seq_len(nrow(raw_results)), function(i) {
    if (has_row_pos) {
      v <- suppressWarnings(as.integer(raw_results$Target_Position_N[i]))
      if (!is.na(v)) return(v)
    }
    as.integer(target_position_value)
  }, integer(1))

  # per-file 旁观位（由 process_single_file 随行写入）。目标位那套「没给就回退顶层」
  # 的规矩在这里不成立——旁观位没有顶层单值。列不存在或某行没给 → 该行留 NA，
  # 让「这支料还没定旁观位」与「定了、测出来是 0%」分得开。
  has_row_bys <- "Bystander_Position_N" %in% names(raw_results)
  bys_vec <- vapply(seq_len(nrow(raw_results)), function(i) {
    if (!has_row_bys) return(NA_integer_)
    suppressWarnings(as.integer(raw_results$Bystander_Position_N[i]))
  }, integer(1))

  summary_df <- data.frame(
    Table_Name = raw_results$Table_Name,
    Target_Base = raw_results$Target_Base,
    Edited_Base = raw_results$Edited_Base,
    Target_Position = paste0(raw_results$Target_Base, pos_vec),
    Target_Position_Edit_Rate = NA_real_,
    # 目标位上的四碱基占比（2026-09-21 换进来，替掉「总非参比 / 非预期替换」两列）。
    # 理由与口径换算见 `read_position_base_rates()`。
    # 注意 2026-09-21 晚：`Edit_Product_Purity_at_Target_Position` 也去掉了。用户口径：
    # C 只要被改掉就是有效产物，C→G / C→A 不是「杂质」；纯度只算 C→T 占非参比的比例，
    # 在主产物不是 C→T 的位点上会把结论报低（真包一例：纯度 23.1% vs 总编辑率 34.6%）。
    # 要那个数的人从这四格自己算，要哪个口径自己挑。
    Target_A_Rate = NA_real_,
    Target_C_Rate = NA_real_,
    Target_G_Rate = NA_real_,
    Target_T_Rate = NA_real_,
    Bystander_Position = ifelse(is.na(bys_vec), NA_character_,
                                paste0(raw_results$Target_Base, bys_vec)),
    Bystander_Position_Edit_Rate = NA_real_,
    Editable_Sites = length(edit_rate_cols),
    Max_Edit_Rate = NA_real_,
    Top_Position = NA_character_,
    Top_Position_Edit_Rate = NA_real_,
    Non_Target_Edit_Rate_at_Top_Position = NA_real_,
    Unintended_Substitution_Rate_at_Top_Position = NA_real_,
    Edit_Product_Purity_at_Top_Position = NA_real_,
    Analysis_Guide = if ("Analysis_Guide" %in% names(raw_results)) raw_results$Analysis_Guide else NA_character_,
    stringsAsFactors = FALSE
  )

  for (i in seq_len(nrow(raw_results))) {
    rates <- suppressWarnings(as.numeric(raw_results[i, edit_rate_cols, drop = TRUE]))
    valid_rates <- rates[!is.na(rates)]
    target_edit_rate_col <- paste0("N", pos_vec[i], "_edit_rate")
    if (target_edit_rate_col %in% names(raw_results)) {
      summary_df$Target_Position_Edit_Rate[i] <- round(
        suppressWarnings(as.numeric(raw_results[i, target_edit_rate_col, drop = TRUE])),
        2
      )
    }
    target_bases <- read_position_base_rates(raw_results, i, pos_vec[i])
    summary_df$Target_A_Rate[i] <- round(target_bases[["A"]], 2)
    summary_df$Target_C_Rate[i] <- round(target_bases[["C"]], 2)
    summary_df$Target_G_Rate[i] <- round(target_bases[["G"]], 2)
    summary_df$Target_T_Rate[i] <- round(target_bases[["T"]], 2)
    # 旁观位只取编辑率一项：Hub 这一轮只要两列，纯度那三个指标等 Hub 说要再加。
    # 那一位没给、或指到的列不在结果表里（例如指到了别的碱基上）→ 留 NA，不填 0。
    if (!is.na(bys_vec[i])) {
      bys_edit_rate_col <- paste0("N", bys_vec[i], "_edit_rate")
      if (bys_edit_rate_col %in% names(raw_results)) {
        summary_df$Bystander_Position_Edit_Rate[i] <- round(
          suppressWarnings(as.numeric(raw_results[i, bys_edit_rate_col, drop = TRUE])),
          2
        )
      }
    }
    if (length(valid_rates) == 0) {
      next
    }
    summary_df$Max_Edit_Rate[i] <- round(max(valid_rates), 2)
    max_index <- which.max(rates)
    top_edit_rate_col <- edit_rate_cols[max_index]
    top_position <- sub("^N([0-9]+)_edit_rate$", "\\1", top_edit_rate_col)
    top_non_target_col <- sub("_edit_rate$", "_non_target_edit_rate", top_edit_rate_col)
    summary_df$Top_Position[i] <- paste0(raw_results$Target_Base[i], top_position)
    summary_df$Top_Position_Edit_Rate[i] <- round(rates[max_index], 2)
    if (top_non_target_col %in% names(raw_results)) {
      summary_df$Non_Target_Edit_Rate_at_Top_Position[i] <- round(
        suppressWarnings(as.numeric(raw_results[i, top_non_target_col, drop = TRUE])),
        2
      )
    }
    top_quality <- calculate_position_quality_metrics(
      raw_results,
      i,
      top_position,
      as.character(raw_results$Target_Base[i]),
      as.character(raw_results$Edited_Base[i])
    )
    summary_df$Unintended_Substitution_Rate_at_Top_Position[i] <- round(
      top_quality$unintended_substitution,
      2
    )
    summary_df$Edit_Product_Purity_at_Top_Position[i] <- round(
      top_quality$product_purity,
      2
    )
  }

  summary_df
}

#' 应用文件名规则
#' @param file_names 文件名向量
#' @param pattern 正则表达式
#' @param replacement 替换字符串
#' @return character vector
apply_filename_rule <- function(file_names, pattern, replacement) {
  cleaned_names <- gsub(pattern, replacement, file_names, perl = TRUE)
  cleaned_names <- trimws(cleaned_names)
  cleaned_names[cleaned_names == ""] <- file_names[cleaned_names == ""]
  cleaned_names
}

#' 规范化标签
#' @param tag_value 标签值
#' @return character
normalize_tag <- function(tag_value) {
  if (is.null(tag_value)) {
    return("")
  }
  cleaned_tag <- trimws(tag_value)
  cleaned_tag <- gsub("[^A-Za-z0-9._-]+", "_", cleaned_tag, perl = TRUE)
  cleaned_tag <- gsub("_+", "_", cleaned_tag, perl = TRUE)
  cleaned_tag <- gsub("^_+|_+$", "", cleaned_tag, perl = TRUE)
  cleaned_tag
}

#' 计算重命名后的文件名
#' @param file_names 原始文件名向量
#' @param pattern 正则表达式
#' @param replacement 替换字符串
#' @param tag_value 标签值
#' @return data.frame with Original_Name, Preview_Name, Download_File
compute_renamed_files <- function(file_names, pattern = NULL, replacement = NULL, tag_value = NULL) {
  # 委托 compute_rename_map（与分析同一口径），保证预览名严格等于分析 Table_Name。
  rc <- list(
    pattern = pattern %||% "",
    replacement = replacement %||% "",
    tag = tag_value %||% ""
  )
  nm <- compute_rename_map(file_names, rc)
  preview_names <- unname(nm[file_names])
  data.frame(
    Original_Name = file_names,
    Preview_Name = preview_names,
    Download_File = paste0(preview_names, ".ab1"),
    stringsAsFactors = FALSE
  )
}

# ============================================================
# 分组（grouping）：条件 Condition + 重复组 Replicate
# ============================================================

#' 把前端传来的分组（list of list(table_name, condition, replicate, guideName, variables)）转成 data.frame
#' @return data.frame(Table_Name, Condition, Replicate, Guide_Name, <一列每个变量>) 或 NULL
grouping_to_df <- function(grouping) {
  if (is.null(grouping) || length(grouping) == 0) return(NULL)
  var_names <- unique(unlist(lapply(grouping, function(g) {
    v <- g$variables %||% g$Variables
    if (is.null(v)) character(0) else names(v)
  })))
  var_names <- var_names[!is.na(var_names) & var_names != ""]
  rows <- lapply(grouping, function(g) {
    tn <- g$table_name %||% g$Table_Name
    if (is.null(tn) || is.na(tn) || tn == "") return(NULL)
    base <- data.frame(
      Table_Name = as.character(tn),
      Condition = as.character(g$condition %||% g$Condition %||% ""),
      Replicate = as.character(g$replicate %||% g$Replicate %||% ""),
      Guide_Name = as.character(g$guideName %||% g$guide_name %||% g$Guide_Name %||% ""),
      hsgRNA = as.character(g$hsgRNA %||% g$hsgrna %||% ""),
      tBE_mRNA = as.character(g$tbeMrna %||% g$tbe_mrna %||% g$tBE_mRNA %||% ""),
      stringsAsFactors = FALSE,
      check.names = FALSE
    )
    v <- g$variables %||% g$Variables
    for (nm in var_names) {
      val <- if (!is.null(v) && !is.null(v[[nm]])) as.character(v[[nm]]) else ""
      base[[nm]] <- val
    }
    base
  })
  rows <- rows[!vapply(rows, is.null, logical(1))]
  if (length(rows) == 0) return(NULL)
  df <- do.call(rbind, rows)
  var_blank <- if (length(var_names) == 0) TRUE else
    apply(df[, var_names, drop = FALSE] == "", 1, all)
  df <- df[!(df$Condition == "" & df$Guide_Name == "" &
             df$hsgRNA == "" & df$tBE_mRNA == "" & var_blank), , drop = FALSE]
  if (nrow(df) == 0) return(NULL)
  df
}

#' 把分组列并入摘要数据框（用于 Excel summary sheet）
#' @return 在 Table_Name 后插入 Guide_Name、Condition 与各变量列（不含 Replicate）的 summary_df
merge_grouping_into_summary <- function(summary_df, grouping_df) {
  if (is.null(summary_df) || nrow(summary_df) == 0) return(summary_df)
  if (is.null(grouping_df) || nrow(grouping_df) == 0) return(summary_df)
  idx <- match(summary_df$Table_Name, grouping_df$Table_Name)
  cond <- grouping_df$Condition[idx]; cond[is.na(cond)] <- ""
  gname <- if ("Guide_Name" %in% names(grouping_df)) grouping_df$Guide_Name[idx] else rep("", length(idx))
  gname[is.na(gname)] <- ""
  hsg <- if ("hsgRNA" %in% names(grouping_df)) grouping_df$hsgRNA[idx] else rep("", length(idx))
  hsg[is.na(hsg)] <- ""
  tbe <- if ("tBE_mRNA" %in% names(grouping_df)) grouping_df$tBE_mRNA[idx] else rep("", length(idx))
  tbe[is.na(tbe)] <- ""
  reserved <- c("Table_Name", "Condition", "Replicate", "Guide_Name", "hsgRNA", "tBE_mRNA")
  var_cols <- setdiff(names(grouping_df), reserved)
  out <- data.frame(Table_Name = summary_df$Table_Name, Guide_Name = gname,
                    hsgRNA = hsg, `tBE_mRNA` = tbe, Condition = cond,
                    stringsAsFactors = FALSE, check.names = FALSE)
  for (vc in var_cols) {
    col <- grouping_df[[vc]][idx]; col[is.na(col)] <- ""
    out[[vc]] <- col
  }
  rest <- summary_df[, setdiff(names(summary_df), "Table_Name"), drop = FALSE]
  cbind(out, rest)
}

# 下载包缓存签名的参数部分：rename/template/guide/ref/target 任一变即失效。
digest_params <- function(params) {
  if (is.null(params)) return("")
  rc <- params$rename_config %||% list()
  rc_str <- paste(rc$preset %||% "", rc$pattern %||% "", rc$replacement %||% "", rc$tag %||% "", sep = "")
  go <- params$guide_overrides %||% list()
  # per-file 参数全部进签名：只改目标位不改 guide 时，签名必须跟着变，
  # 否则下载走缓存、拿到的是上一次那个包。
  go_str <- if (length(go) == 0) "" else paste(
    vapply(go, function(o) paste(
      o$file %||% o$table_name %||% "", o$guide %||% "",
      o$target_position %||% "", o$bystander_position %||% "",
      o$target_base %||% "", o$edited_base %||% "",
      sep = "="
    ), character(1)),
    collapse = ";"
  )
  # 纳米孔：派发参数那份 rows 整份进签名，改了任一检测就重打包。
  nano_str <- if (identical(as.character(params$kind %||% "")[1], "nanopore")) {
    digest::digest(params$rows %||% list(), algo = "xxhash64")
  } else ""
  paste(rc_str, params$template_name %||% "", go_str,
        params$ref_sequence %||% "", params$ref_target_pos %||% "", nano_str, sep = "||")
}

#' 获取可用内存 (MB)
#' @return numeric or NA
get_available_memory_mb <- function() {
  sysname <- Sys.info()[["sysname"]]

  if (sysname == "Linux") {
    meminfo_path <- "/proc/meminfo"
    if (!file.exists(meminfo_path)) {
      return(NA_real_)
    }
    meminfo_lines <- tryCatch(readLines(meminfo_path), error = function(e) character())
    mem_available_line <- meminfo_lines[grepl("^MemAvailable:", meminfo_lines)]
    if (length(mem_available_line) == 0) {
      return(NA_real_)
    }
    mem_kb <- suppressWarnings(as.numeric(gsub("[^0-9]", "", mem_available_line[1])))
    if (is.na(mem_kb)) {
      return(NA_real_)
    }
    return(mem_kb / 1024)
  }

  if (sysname == "Darwin") {
    tryCatch({
      vm_stat_out <- system("vm_stat", intern = TRUE)
      page_size_line <- vm_stat_out[1]
      page_size <- as.numeric(gsub("[^0-9]", "", page_size_line))
      if (is.na(page_size) || page_size <= 0) {
        return(NA_real_)
      }
      free_line <- vm_stat_out[grepl("^Pages free:", vm_stat_out)]
      inactive_line <- vm_stat_out[grepl("^Pages inactive:", vm_stat_out)]
      if (length(free_line) == 0 || length(inactive_line) == 0) {
        return(NA_real_)
      }
      free_pages <- as.numeric(gsub("[^0-9]", "", free_line[1]))
      inactive_pages <- as.numeric(gsub("[^0-9]", "", inactive_line[1]))
      if (is.na(free_pages) || is.na(inactive_pages)) {
        return(NA_real_)
      }
      (free_pages + inactive_pages) * page_size / (1024 * 1024)
    }, error = function(e) NA_real_)
  } else {
    NA_real_
  }
}

#' 分类分析错误
#' @param error_message 原始错误信息
#' @return list with error_code and error_label
#' 批量分析一个 session 目录下的 .ab1 文件（analyze 与 prepare 共用的唯一入口）
#'
#' 重命名在此前置：先算好「原始名 -> 重命名后干净名」的映射，分析结果的
#' Table_Name 直接用重命名后的名字，因此网页结果 / 图表 / Excel 摘要天然一致。
#' @return list(raw_df, summary_df, display_df, heatmap_df, errors, name_map,
#'              n_files, n_success, processing_mode, target_position, ...)
#' 在参考序列中查找 guide 的位置（正链或负链）
#' @return list(offset, strand) 或 NULL（未找到）
find_guide_in_ref <- function(guide, ref_seq) {
  g <- toupper(guide)
  r <- toupper(ref_seq)
  fwd <- regexpr(g, r, fixed = TRUE)[[1]]
  if (fwd > 0) return(list(offset = fwd - 1L, strand = "+"))  # 0-based
  rc_g <- as.character(Biostrings::reverseComplement(Biostrings::DNAString(g)))
  rev <- regexpr(rc_g, r, fixed = TRUE)[[1]]
  if (rev > 0) return(list(offset = rev - 1L, strand = "-"))
  NULL
}

#' guide.position (1-based) → 0-based 绝对参考坐标
guide_pos_to_abs <- function(gp, offset, strand, guide_len) {
  if (strand == "+") return(offset + (gp - 1L))
  offset + (guide_len - gp)
}

# 解析 ref 模式的目标绝对位（0-based）。ref_target_pos（参比绝对 1-based）优先；
# 否则按默认 guide 把 target_position(guide 相对)映射；再否则 guide 相对降级。
resolve_ref_target_abs <- function(ref_target_pos, target_position, default_aln, seq_len) {
  if (!is.null(ref_target_pos)) return(as.integer(ref_target_pos) - 1L)
  if (!is.null(default_aln)) return(guide_pos_to_abs(target_position, default_aln$offset, default_aln$strand, seq_len))
  as.integer(target_position) - 1L
}

# 参比模式按 guide 对齐链选编辑位（0-based）。
# guide 反向互补对齐参比时（'-' 链），目标碱基（如 C）在参比上是其互补（G）。
ref_edit_positions <- function(ref_chars, target_base, strand) {
  base <- toupper(target_base)
  if (!is.null(strand) && identical(strand, "-")) {
    base <- chartr("ACGT", "TGCA", base)
  }
  which(ref_chars == base) - 1L
}

# 0-based 绝对参考坐标 → guide.position（1-based）；guide_pos_to_abs 的逆运算。
# guide 没对齐上参比时降级为 abs_pos + 1，与原行为一致。
abs_to_guide_pos <- function(abs_pos, guide_aln, guide_len) {
  if (is.null(guide_aln)) return(as.integer(abs_pos) + 1L)
  if (identical(guide_aln$strand, "+")) return(as.integer(abs_pos - guide_aln$offset + 1L))
  as.integer(guide_aln$offset + guide_len - abs_pos)
}

# 这个 guide.position 在**这条 guide 自己**身上是不是目标碱基位。
#
# 列集合只按**默认 guide** 的链算一次（ref_edit_positions），可每个文件的 guide 是各自
# 对齐的。某条 guide 若与默认链相反，同一个绝对坐标落到它身上就是互补碱基
# （参比 C <-> guide G）；此时再去取 C.perc，拿到的是 G 位上的本底噪声（约 0~2%），
# non_target_edit_rate 还会算成 98 左右——不报错、不落 errors，直接进 summary 和推送。
# 传统模式（下面那支）一直有这道守卫，参比模式漏了，这里补上。
guide_pos_is_target <- function(gp, guide_chars, target_base) {
  if (length(gp) != 1L || is.na(gp)) return(FALSE)
  gp >= 1L && gp <= length(guide_chars) && identical(guide_chars[gp], toupper(target_base))
}

# 查找某个 ab1 文件对应的 per-file 覆盖条目：先按原始文件名(file) 匹配，
# 再按重命名后 table_name（或旧 pattern）匹配，都无则 NULL。
# guide、目标位、碱基共用这一条查找口径——匹配规则只写一遍，不会各处走样。
resolve_effective_override <- function(fname, table_name, guide_overrides) {
  if (is.null(guide_overrides) || length(guide_overrides) == 0) return(NULL)
  for (ov in guide_overrides) {
    ov_file <- ov$file %||% ""
    if (nzchar(ov_file) && identical(ov_file, fname)) return(ov)
  }
  for (ov in guide_overrides) {
    ov_tn <- ov$table_name %||% ov$pattern %||% ""
    if (nzchar(ov_tn) && identical(ov_tn, table_name)) return(ov)
  }
  NULL
}

# 解析某个 ab1 文件应使用的 guide；条目缺 guide 键时回退全局 default_guide。
resolve_effective_guide <- function(fname, table_name, default_guide, guide_overrides) {
  ov <- resolve_effective_override(fname, table_name, guide_overrides)
  g <- if (is.null(ov)) NULL else ov$guide
  if (is.null(g) || !nzchar(as.character(g))) return(default_guide)
  as.character(g)
}

# 把某文件的 per-file 目标位（guide 相对 1-based）换算成结果表里的列号
# （列名 N 后面那个数）。没给 per-file 值时回退 fallback_col（顶层口径算出的那一位）。
# 参比模式且 guide 在参比里对上 → 按对齐换到参比绝对坐标；对不上则沿用现有
# 回退口径（直接拿 guide 相对位当列号），与 process_single_file 里 guide_aln
# 为 NULL 时那条分支保持一致。
resolve_row_target_col <- function(per_file_pos, fallback_col, ref_mode, guide_aln, guide_len) {
  fb <- as.integer(fallback_col)
  if (is.null(per_file_pos)) return(fb)
  gp <- suppressWarnings(as.integer(per_file_pos))
  if (length(gp) != 1 || is.na(gp)) return(fb)
  if (!isTRUE(ref_mode) || is.null(guide_aln)) return(gp)
  as.integer(guide_pos_to_abs(gp, guide_aln$offset, guide_aln$strand, guide_len) + 1L)
}

# 把某文件的旁观位（guide 相对 1-based）换算成结果表里的列号，换算口径与目标位完全一样。
# 差别只在「没给」的含义：旁观位没有顶层单值可回退，没给就是没有 —— 留 NA，
# 让「这支料还没定旁观位」与「定了但这一位没测到」在下游仍然分得开。
resolve_row_bystander_col <- function(per_file_pos, ref_mode, guide_aln, guide_len) {
  resolve_row_target_col(per_file_pos, NA_integer_, ref_mode, guide_aln, guide_len)
}

# 校验 per-file 分析参数。碱基只在契约里留格子、不做逐样品分方向，所以整批
# 取值必须一致；目标位必须落在该行 guide 内。返回 NULL 表示通过，否则返回
# 给用户看的中文错误串（点名到文件，别让人自己去猜是哪一行）。
validate_guide_overrides <- function(guide_overrides, default_target_base, default_edited_base,
                                     default_guide = "") {
  if (is.null(guide_overrides) || length(guide_overrides) == 0) return(NULL)

  who <- function(ov) as.character(ov$file %||% ov$table_name %||% ov$pattern %||% "?")
  collect <- function(key) {
    vals <- character(0); files <- character(0)
    for (ov in guide_overrides) {
      v <- toupper(trimws(as.character(ov[[key]] %||% "")))
      if (nzchar(v)) { vals <- c(vals, v); files <- c(files, who(ov)) }
    }
    list(vals = vals, files = files)
  }

  for (key in c("target_base", "edited_base")) {
    got <- collect(key)
    uniq <- unique(got$vals)
    if (length(uniq) > 1) {
      detail <- paste(sprintf("%s=%s", got$files, got$vals), collapse = "、")
      return(sprintf(
        "同一次分析里 %s 只能有一个取值，收到 %d 种：%s。请回 Hub 按编辑方向拆成多次分析。",
        key, length(uniq), detail))
    }
  }

  tb <- unique(collect("target_base")$vals)
  eb <- unique(collect("edited_base")$vals)

  # 「整批一致」是跨层的规矩，不只是逐行之间。逐行只给了一个取值、却与顶层不同时，
  # 不能默默按顶层跑——那个样品的编辑方向就被无声换掉了。
  for (chk in list(list(k = "target_base", rows = tb, top = default_target_base),
                   list(k = "edited_base", rows = eb, top = default_edited_base))) {
    top_v <- toupper(trimws(as.character(chk$top %||% "")))
    if (length(chk$rows) == 1 && nzchar(top_v) && !identical(chk$rows, top_v)) {
      return(sprintf("per-file %s 是 %s，顶层是 %s，两者不一致。请统一后再提交。",
                     chk$k, chk$rows, top_v))
    }
  }

  eff_tb <- if (length(tb) == 1) tb else toupper(trimws(as.character(default_target_base %||% "")))
  eff_eb <- if (length(eb) == 1) eb else toupper(trimws(as.character(default_edited_base %||% "")))
  if (nzchar(eff_tb) && identical(eff_tb, eff_eb)) {
    return("目标碱基和编辑后碱基不能相同。")
  }

  # 目标位与旁观位共用这一套位号校验：都是 guide 相对 1-based，都必须落在该行 guide 内。
  # 两者只有「没给」的含义不同（目标位回退顶层、旁观位就是没有），而「没给」本来就不报错。
  pos_checks <- list(list(key = "target_position", label = "目标位"),
                     list(key = "bystander_position", label = "旁观位"))
  for (ov in guide_overrides) {
    # 条目不带 guide 时，它的「该行 guide」就是顶层默认 guide——per-file 缺省回退顶层
    # 是本设计的总规矩，上界检查不该在这里破例放行。
    g <- as.character(ov$guide %||% "")
    if (!nzchar(g)) g <- as.character(default_guide %||% "")
    for (chk in pos_checks) {
      tp <- ov[[chk$key]]
      if (is.null(tp)) next
      p <- suppressWarnings(as.integer(tp))
      if (length(p) != 1 || is.na(p)) {
        # 给了却解析不出来，不能当「没给」处理——那会让这个样品悄悄退回批次默认位
        # （旁观位则是悄悄变成没有旁观位），而摘要表上看不出区别。
        return(sprintf("文件 %s 的%s %s 不是合法的整数。",
                       who(ov), chk$label, paste(as.character(tp), collapse = ",")))
      }
      if (p < 1 || (nzchar(g) && p > nchar(g))) {
        return(sprintf("文件 %s 的%s %s 超出 guide 范围（guide 长 %d 位）。",
                       who(ov), chk$label, as.character(tp), nchar(g)))
      }
    }
  }
  NULL
}

# 把 getEditing 的完整 guide 窗口压成前端后处理需要的稳定信号契约。
# 百分比已在 CreateEditingDF 中统一到 guide 方向；不受本次 target/edited/ref 参数限制。
build_signal_rows <- function(editing_df, table_name, guide) {
  required <- c("guide.position", "guide.seq", "A.perc", "C.perc", "G.perc", "T.perc")
  if (is.null(editing_df) || nrow(editing_df) == 0 || !all(required %in% names(editing_df))) {
    return(data.frame(
      Table_Name = character(), Analysis_Guide = character(), Guide_Position = integer(),
      Guide_Base = character(), A = numeric(), C = numeric(), G = numeric(), T = numeric(),
      stringsAsFactors = FALSE
    ))
  }
  data.frame(
    Table_Name = rep(as.character(table_name), nrow(editing_df)),
    Analysis_Guide = rep(as.character(guide), nrow(editing_df)),
    Guide_Position = as.integer(editing_df$guide.position),
    Guide_Base = as.character(editing_df$guide.seq),
    A = as.numeric(editing_df$A.perc), C = as.numeric(editing_df$C.perc),
    G = as.numeric(editing_df$G.perc), T = as.numeric(editing_df$T.perc),
    stringsAsFactors = FALSE
  )
}

# guide 上下游读值（getEditing 挂在 editing_df 的 "flank" 属性上）加上样品名与 guide，
# 汇成多序列页「上下游扫一眼」与结果包 flank 表用的长表。只给人看，不进推 Hub 的载荷。
build_flank_rows <- function(editing_df, table_name, guide) {
  flank <- if (is.null(editing_df)) NULL else attr(editing_df, "flank")
  if (is.null(flank) || nrow(flank) == 0) return(NULL)
  cbind(data.frame(Table_Name = rep(as.character(table_name), nrow(flank)),
                   Analysis_Guide = rep(as.character(guide), nrow(flank)),
                   stringsAsFactors = FALSE),
        flank)
}

run_batch_analysis <- function(session_dir, sequence, target_position,
                               target_base, edited_base,
                               rename_config = list(), rename_presets = NULL,
                               guide_overrides = list(), ref_sequence = NULL,
                               ref_target_pos = NULL) {
  ab1_files <- list.files(session_dir, pattern = "\\.ab1$", ignore.case = TRUE, full.names = TRUE)
  ab1_files <- ab1_files[!grepl("zip_output", ab1_files)]
  # 分析顺序即 summary_df 的行序，也是没有前端 summary_override 时（归档重分析、
  # Hub 侧重跑）Excel 与推送数据的行序，所以这里就按自然序定下来。
  ab1_files <- sort_natural(ab1_files)
  if (length(ab1_files) == 0) {
    stop("会话中没有 .ab1 文件。")
  }

  file_names <- basename(ab1_files)
  name_map <- compute_rename_map(file_names, rename_config, rename_presets)

  use_ref_mode <- length(guide_overrides) > 0 && !is.null(ref_sequence) && nchar(ref_sequence) > 0

  metric_columns <- c("A.perc", "C.perc", "G.perc", "T.perc")
  metric_labels <- c("A", "C", "G", "T")
  target_metric <- paste0(target_base, ".perc")
  edited_metric <- paste0(edited_base, ".perc")

  if (use_ref_mode) {
    # ── 参考序列模式 ─────────────────────────────────────────────────
    # 计算默认 guide 在 ref 中的 offset，用于把 target_position (guide-relative)
    # 转成绝对坐标。若直接找不到，回退到 guide-relative 坐标。
    default_aln <- find_guide_in_ref(sequence, ref_sequence)
    ref_target_abs <- resolve_ref_target_abs(ref_target_pos, target_position, default_aln, nchar(sequence))
    # 在 ref 中找到哪些绝对坐标位置有 target_base，用于生成列名
    ref_chars <- strsplit(toupper(ref_sequence), "")[[1]]
    abs_positions <- ref_edit_positions(
      ref_chars, target_base,
      if (!is.null(default_aln)) default_aln$strand else NULL
    )
    if (length(abs_positions) == 0) abs_positions <- ref_target_abs
    # 列名基于绝对坐标（1-based 显示）
    column_names <- c("Target_Base", "Edited_Base", "Analysis_Guide")
    for (abs_pos in abs_positions) {
      position_prefix <- paste0("N", abs_pos + 1L)
      column_names <- c(
        column_names,
        paste0(position_prefix, "_", target_base, "_ref"),
        paste0(position_prefix, "_", edited_base, "_edit"),
        paste0(position_prefix, "_edit_rate"),
        paste0(position_prefix, "_non_target_edit_rate")
      )
      column_names <- c(column_names, paste0(position_prefix, "_", metric_labels))
    }
    column_names <- c(column_names, "Target_Position_N", "Bystander_Position_N", "Table_Name")

    process_single_file <- function(f_path) {
      fname <- basename(f_path)
      tryCatch({
        # 找到这个文件对应的 guide：先按原始文件名，再按重命名后的 table_name 匹配
        table_name_for_file <- unname(name_map[[fname]])
        effective_guide <- resolve_effective_guide(fname, table_name_for_file, sequence, guide_overrides)
        editing_df <- getEditing(f_path, effective_guide)
        guide_len <- nchar(effective_guide)
        guide_aln <- find_guide_in_ref(effective_guide, ref_sequence)
        guide_chars <- strsplit(toupper(effective_guide), "")[[1]]

        row_result <- list()
        row_result[["Target_Base"]] <- target_base
        row_result[["Edited_Base"]] <- edited_base
        row_result[["Analysis_Guide"]] <- effective_guide

        for (abs_pos in abs_positions) {
          prefix <- paste0("N", abs_pos + 1L)
          # 把绝对坐标转回该 guide 的 guide.position（guide 不在 ref 中时降级为 abs_pos + 1）
          gp <- abs_to_guide_pos(abs_pos, guide_aln, guide_len)
          # 守卫：该位在这条 guide 自己身上必须真是目标碱基，否则取到的是别的碱基位上的噪声。
          pos_data <- if (guide_pos_is_target(gp, guide_chars, target_base)) {
            editing_df[editing_df$guide.position == gp, ]
          } else {
            editing_df[0, ]
          }
          if (nrow(pos_data) == 0) {
            # 该绝对位置不在此 guide 窗口内，或在这条 guide 上不是目标碱基位 → 填 NA
            row_result[[paste0(prefix, "_", target_base, "_ref")]] <- NA_real_
            row_result[[paste0(prefix, "_", edited_base, "_edit")]] <- NA_real_
            row_result[[paste0(prefix, "_edit_rate")]] <- NA_real_
            row_result[[paste0(prefix, "_non_target_edit_rate")]] <- NA_real_
            for (ml in metric_labels) row_result[[paste0(prefix, "_", ml)]] <- NA_real_
          } else {
            row_result[[paste0(prefix, "_", target_base, "_ref")]] <- as.numeric(pos_data[[target_metric]])
            row_result[[paste0(prefix, "_", edited_base, "_edit")]] <- as.numeric(pos_data[[edited_metric]])
            row_result[[paste0(prefix, "_edit_rate")]] <- as.numeric(pos_data[[edited_metric]])
            row_result[[paste0(prefix, "_non_target_edit_rate")]] <- 100 - as.numeric(pos_data[[target_metric]])
            for (j in seq_along(metric_columns)) {
              row_result[[paste0(prefix, "_", metric_labels[j])]] <- as.numeric(pos_data[[metric_columns[j]]])
            }
          }
        }
        # 该文件的 per-file 目标位（guide 相对）换算成本表列号；没给就回退顶层那位。
        ov_row <- resolve_effective_override(fname, table_name_for_file, guide_overrides)
        row_result[["Target_Position_N"]] <- resolve_row_target_col(
          if (is.null(ov_row)) NULL else ov_row$target_position,
          ref_target_abs + 1L, TRUE, guide_aln, guide_len
        )
        # 旁观位：Hub 逐支填、随 guide_overrides 送来，没给就是 NA（不回退）。
        row_result[["Bystander_Position_N"]] <- resolve_row_bystander_col(
          if (is.null(ov_row)) NULL else ov_row$bystander_position,
          TRUE, guide_aln, guide_len
        )
        row_result[["Table_Name"]] <- unname(name_map[[fname]])
        list(
          success = TRUE, data = row_result, file = fname,
          signals = build_signal_rows(editing_df, table_name_for_file, effective_guide),
          flank = build_flank_rows(editing_df, table_name_for_file, effective_guide)
        )
      }, error = function(e) {
        list(success = FALSE, error = as.character(e$message), file = fname)
      })
    }

    # target_position for summary = ref_target_abs + 1 (1-based column N index)
    effective_target_position <- ref_target_abs + 1L

  } else {
    # ── 传统模式（不变） ──────────────────────────────────────────────
    # 逐文件用各自 effective_guide 求目标位，列取并集(不同 guide 各自坐标)
    per_file_guides <- lapply(ab1_files, function(fp) {
      fname <- basename(fp)
      resolve_effective_guide(fname, unname(name_map[[fname]]), sequence, guide_overrides)
    })
    row_indices <- union_target_positions(per_file_guides, target_base)

    column_names <- c("Target_Base", "Edited_Base", "Analysis_Guide")
    for (row_index in row_indices) {
      position_prefix <- paste0("N", row_index)
      column_names <- c(
        column_names,
        paste0(position_prefix, "_", target_base, "_ref"),
        paste0(position_prefix, "_", edited_base, "_edit"),
        paste0(position_prefix, "_edit_rate"),
        paste0(position_prefix, "_non_target_edit_rate")
      )
      column_names <- c(column_names, paste0(position_prefix, "_", metric_labels))
    }
    column_names <- c(column_names, "Target_Position_N", "Bystander_Position_N", "Table_Name")

    process_single_file <- function(f_path) {
      fname <- basename(f_path)
      tryCatch({
        table_name_for_file2 <- unname(name_map[[fname]])
        effective_guide <- resolve_effective_guide(fname, table_name_for_file2, sequence, guide_overrides)
        guide_chars <- strsplit(effective_guide, "")[[1]]
        editing_df <- getEditing(f_path, effective_guide)
        row_result <- list()
        row_result[["Target_Base"]] <- target_base
        row_result[["Edited_Base"]] <- edited_base
        row_result[["Analysis_Guide"]] <- effective_guide
        for (pos in row_indices) {
          prefix <- paste0("N", pos)
          is_target_here <- pos <= length(guide_chars) && guide_chars[pos] == target_base
          pos_data <- if (is_target_here) editing_df[editing_df$guide.position == pos, ] else editing_df[0, ]
          if (nrow(pos_data) == 0) {
            row_result[[paste0(prefix, "_", target_base, "_ref")]] <- NA_real_
            row_result[[paste0(prefix, "_", edited_base, "_edit")]] <- NA_real_
            row_result[[paste0(prefix, "_edit_rate")]] <- NA_real_
            row_result[[paste0(prefix, "_non_target_edit_rate")]] <- NA_real_
            for (ml in metric_labels) row_result[[paste0(prefix, "_", ml)]] <- NA_real_
          } else {
            row_result[[paste0(prefix, "_", target_base, "_ref")]] <- as.numeric(pos_data[[target_metric]])
            row_result[[paste0(prefix, "_", edited_base, "_edit")]] <- as.numeric(pos_data[[edited_metric]])
            row_result[[paste0(prefix, "_edit_rate")]] <- as.numeric(pos_data[[edited_metric]])
            row_result[[paste0(prefix, "_non_target_edit_rate")]] <- 100 - as.numeric(pos_data[[target_metric]])
            for (j in seq_along(metric_columns)) {
              row_result[[paste0(prefix, "_", metric_labels[j])]] <- as.numeric(pos_data[[metric_columns[j]]])
            }
          }
        }
        # 传统模式下列名就是 guide 相对位，目标位不用换算；没给就回退顶层。
        ov_row2 <- resolve_effective_override(fname, table_name_for_file2, guide_overrides)
        row_result[["Target_Position_N"]] <- resolve_row_target_col(
          if (is.null(ov_row2)) NULL else ov_row2$target_position,
          target_position, FALSE, NULL, nchar(effective_guide)
        )
        # 旁观位：同上，传统模式下列名就是 guide 相对位，不用换算。
        row_result[["Bystander_Position_N"]] <- resolve_row_bystander_col(
          if (is.null(ov_row2)) NULL else ov_row2$bystander_position,
          FALSE, NULL, nchar(effective_guide)
        )
        row_result[["Table_Name"]] <- unname(name_map[[fname]])
        list(
          success = TRUE, data = row_result, file = fname,
          signals = build_signal_rows(editing_df, table_name_for_file2, effective_guide),
          flank = build_flank_rows(editing_df, table_name_for_file2, effective_guide)
        )
      }, error = function(e) {
        list(success = FALSE, error = as.character(e$message), file = fname)
      })
    }

    effective_target_position <- target_position
  }

  enable_parallel <- Sys.getenv("EDITR_ENABLE_PARALLEL", "true") == "true"
  n_files <- length(ab1_files)
  start_time <- proc.time()

  if (enable_parallel && n_files >= 4) {
    n_workers <- tryCatch({
      configured <- Sys.getenv("EDITR_PARALLEL_WORKERS", "")
      if (configured != "") {
        as.integer(configured)
      } else {
        mem_mb <- get_available_memory_mb()
        worker_mem <- as.numeric(Sys.getenv("EDITR_WORKER_MEM_MB", "512"))
        main_reserve <- as.numeric(Sys.getenv("EDITR_MAIN_RESERVE_MB", "2048"))
        if (!is.na(mem_mb) && mem_mb > main_reserve) {
          max(1, min(parallel::detectCores(), floor((mem_mb - main_reserve) / worker_mem)))
        } else {
          max(1, parallel::detectCores() - 1)
        }
      }
    }, error = function(e) { 2 })
    results_list <- parallel::mclapply(ab1_files, process_single_file, mc.cores = n_workers)
    processing_mode <- paste0("parallel (", n_workers, " workers)")
  } else {
    results_list <- lapply(ab1_files, process_single_file)
    processing_mode <- "sequential"
  }

  elapsed <- (proc.time() - start_time)[["elapsed"]]

  success_list <- list()
  signal_list <- list()
  flank_list <- list()
  errors <- list()
  for (item in results_list) {
    # mclapply 子进程崩溃可能返回 try-error，统一兜底
    if (is.list(item) && isTRUE(item$success)) {
      success_list <- c(success_list, list(item$data))
      signal_list <- c(signal_list, list(item$signals))
      if (!is.null(item$flank)) flank_list <- c(flank_list, list(item$flank))
    } else {
      err_msg <- if (is.list(item)) (item$error %||% "未知错误") else as.character(item)
      err_file <- if (is.list(item)) (item$file %||% "未知文件") else "未知文件"
      error_class <- classify_error(err_msg)
      errors <- c(errors, list(list(
        file = err_file, error = err_msg,
        error_code = error_class$error_code, error_label = error_class$error_label
      )))
    }
  }

  if (length(success_list) == 0) {
    stop(structure(
      class = c("editr_all_failed", "error", "condition"),
      list(message = "所有文件分析失败。", call = NULL, errors = errors)
    ))
  }

  raw_df <- do.call(rbind, lapply(success_list, function(x) {
    row <- x[column_names]
    as.data.frame(row, stringsAsFactors = FALSE)
  }))
  colnames(raw_df) <- column_names
  signal_df <- if (length(signal_list) > 0) do.call(rbind, signal_list) else build_signal_rows(NULL, "", "")
  flank_df <- if (length(flank_list) > 0) do.call(rbind, flank_list) else NULL

  list(
    raw_df = raw_df,
    signal_df = signal_df,
    flank_df = flank_df,
    summary_df = build_summary_results(raw_df, effective_target_position),
    display_df = build_display_results(raw_df),
    heatmap_df = build_heatmap_data(raw_df),
    errors = errors,
    name_map = name_map,
    n_files = n_files,
    n_success = length(success_list),
    processing_mode = processing_mode,
    elapsed_seconds = round(elapsed, 1),
    target_position = effective_target_position
  )
}

classify_error <- function(error_message) {
  if (is.null(error_message) || is.na(error_message)) {
    return(list(error_code = "unknown", error_label = "分析失败"))
  }
  msg <- as.character(error_message)
  if (grepl("替换数据里有.*行，但数据有", msg)) {
    list(error_code = "seq_quality", error_label = "测序质量差")
  } else if (grepl("Failed to find a guide match", msg)) {
    list(error_code = "no_match", error_label = "找不到匹配序列")
  } else {
    list(error_code = "analysis_error", error_label = "分析失败")
  }
}

# JSON 请求中的对象行数组转 data.frame；用于绘图后处理结果覆盖 summary。
payload_rows_to_df <- function(rows) {
  if (is.null(rows) || length(rows) == 0) return(NULL)
  if (is.data.frame(rows)) return(rows)
  if (!is.list(rows)) return(NULL)
  all_names <- unique(unlist(lapply(rows, names)))
  if (length(all_names) == 0) return(NULL)
  frames <- lapply(rows, function(row) {
    values <- lapply(all_names, function(name) {
      value <- row[[name]]
      if (is.null(value) || length(value) == 0) NA else unlist(value)[1]
    })
    names(values) <- all_names
    as.data.frame(values, stringsAsFactors = FALSE, check.names = FALSE)
  })
  do.call(rbind, frames)
}

#' 创建 ZIP 文件，优先使用不依赖系统 zip 命令的 zip 包
#' @param zip_path ZIP 输出路径
#' @param files 要打包的相对路径列表（可为目录）
#' @param recurse 是否递归打包目录内容并保留子目录结构
create_zip_archive <- function(zip_path, files, recurse = FALSE) {
  if (requireNamespace("zip", quietly = TRUE)) {
    zip::zip(
      zipfile = zip_path,
      files = files,
      recurse = recurse,
      compression_level = 9,
      mode = "cherry-pick"
    )
  } else {
    flags <- if (recurse) "-r9Xq" else "-9Xq"
    utils::zip(zip_path, files = files, flags = flags)
  }
}

#' 前端图缓存摘要：拼接各 filename:<base64 内容哈希>（digest::digest(..., algo="xxhash64")），按 filename 排序，保证内容变→摘要变。
charts_cache_digest <- function(frontend_charts) {
  if (is.null(frontend_charts) || length(frontend_charts) == 0) return("")
  parts <- vapply(frontend_charts, function(c) {
    fn <- as.character(c$filename %||% "")
    b64 <- as.character(c$data_base64 %||% "")
    paste0(fn, ":", digest::digest(b64, algo = "xxhash64"))
  }, character(1))
  paste(sort(parts), collapse = "|")
}

#' 结果包里 charts/.export-contract 的版本号。导出图的规格变一次就 +1。
#' 1 = 图上不带界面控件、guide 对齐下逐组标目标位（2026-08-25）。
#' 2 = 编辑谱左侧标签改成「样品列 + 若干变量列」并按排序变量分块加块头，
#'     图因此比 v1 宽约 14%（2026-08-29）。Hub 侧无需配合：它的闸门是
#'     `version < EXPORT_CONTRACT_MIN`（=1），2 照常通过；规整推送那条路径
#'     根本不看版本号。图只是变宽，Hub 用百分比宽度嵌入，不裁不变形。
EXPORT_CONTRACT_VERSION <- 2L

#' 把前端截图（list(list(filename, data_base64))）解码写入 charts_dir。
#' 文件名安全化 + 仅取 basename 防目录穿越；单张失败跳过。返回写入文件名向量。
write_frontend_charts <- function(charts_dir, frontend_charts) {
  if (is.null(frontend_charts) || length(frontend_charts) == 0) return(character(0))
  dir.create(charts_dir, recursive = TRUE, showWarnings = FALSE)
  written <- character(0)
  for (c in frontend_charts) {
    fn <- basename(as.character(c$filename %||% ""))
    fn <- gsub("[^A-Za-z0-9._-]+", "_", fn)
    if (!nzchar(fn)) next
    ok <- tryCatch({
      raw <- base64enc::base64decode(as.character(c$data_base64 %||% ""))
      writeBin(raw, file.path(charts_dir, fn))
      TRUE
    }, error = function(e) FALSE)
    if (ok) written <- c(written, fn)
  }
  written
}

#' 生成结果 ZIP 包（按类型分子目录：ab1_files / charts / analysis_summary）
#' @param session_dir session 目录路径
#' @param summary_df 摘要数据框（Table_Name 已是重命名后的名字）
#' @param raw_df 原始数据框 (含 N*_edit_rate 列，Table_Name 已重命名)
#' @param errors_list 错误列表
#' @param name_map 命名映射：原始文件名 -> 重命名后干净名（来自 compute_rename_map）
#' @param template_name 模板名
#' @return ZIP 文件路径
generate_results_zip <- function(session_dir, summary_df, raw_df,
                                  errors_list, name_map = NULL,
                                  template_name = "results",
                                  grouping_df = NULL,
                                  frontend_charts = NULL,
                                  flank_df = NULL) {
  # 创建临时工作目录 (先清理旧的)，三类内容分子目录存放
  zip_work_dir <- file.path(session_dir, "zip_output")
  unlink(zip_work_dir, recursive = TRUE)
  dir.create(zip_work_dir, recursive = TRUE, showWarnings = FALSE)
  files_dir <- file.path(zip_work_dir, "ab1_files")          # 重命名后的 .ab1
  charts_dir <- file.path(zip_work_dir, "charts")            # 图表 PNG
  summary_dir <- file.path(zip_work_dir, "analysis_summary") # Excel 汇总
  for (d in c(files_dir, charts_dir, summary_dir)) {
    dir.create(d, recursive = TRUE, showWarnings = FALSE)
  }

  # --- 1. 重命名 AB1 文件（用与分析一致的 name_map + 状态后缀）---
  all_ab1 <- list.files(session_dir, pattern = "\\.ab1$", ignore.case = TRUE, full.names = FALSE)
  all_ab1 <- all_ab1[!grepl("^zip_output", all_ab1)]

  # 构建错误映射
  error_map <- list()
  for (err in errors_list) {
    error_map[[err$file]] <- err$error_code
  }

  for (fname in all_ab1) {
    base_name <- if (!is.null(name_map) && !is.null(name_map[[fname]])) {
      unname(name_map[[fname]])
    } else {
      tools::file_path_sans_ext(fname)
    }
    if (fname %in% names(error_map)) {
      status_tag <- paste0("failed_", error_map[[fname]])
    } else {
      status_tag <- "success"
    }
    new_name <- paste0(base_name, "_", status_tag, ".ab1")
    file.copy(
      file.path(session_dir, fname),
      file.path(files_dir, new_name)
    )
  }

  # --- 2. 生成 Excel ---
  excel_path <- file.path(summary_dir, "analysis_results.xlsx")
  sheets <- list()
  if (!is.null(summary_df) && nrow(summary_df) > 0) {
    # 有分组时把 Condition / Replicate 列并入 summary，并单列一张 grouping sheet
    sheets[["summary"]] <- merge_grouping_into_summary(summary_df, grouping_df)
    if (!is.null(grouping_df) && nrow(grouping_df) > 0) {
      sheets[["grouping"]] <- grouping_df
    }
  }
  if (!is.null(raw_df) && nrow(raw_df) > 0) {
    sheets[["raw"]] <- round_numeric_columns(raw_df)
  }
  # guide 上下游各 50 位的读值。注意 表名不能叫 raw：Hub 按表名只抽 raw 那一张进库，
  # 这张单独起名 flank，Hub 不读、不进 ELN 正文，只随结果包附件原样留着（2026-09-23 用户定）。
  if (!is.null(flank_df) && nrow(flank_df) > 0) {
    sheets[["flank"]] <- flank_df
  }
  if (length(errors_list) > 0) {
    err_df <- data.frame(
      Original_Filename = sapply(errors_list, `[[`, "file"),
      Error_Code = sapply(errors_list, `[[`, "error_code"),
      Error_Label = sapply(errors_list, `[[`, "error_label"),
      Error_Message = sapply(errors_list, `[[`, "error"),
      stringsAsFactors = FALSE
    )
    sheets[["failed_files"]] <- err_df
  }
  if (length(sheets) > 0) {
    writexl::write_xlsx(sheets, excel_path)
  }

  # --- 3. 图表：写入前端截图（不再用 R ggplot 出图）---
  written_charts <- write_frontend_charts(charts_dir, frontend_charts)
  # 导出契约版本号：下游（Hub）靠它区分「这一批的图是新规格导出的」和存量老包，
  # 否则只看有没有 profile_editing.png 会把带工具栏、没有目标位框的旧图也当新图用。
  # 导出规格再变就 +1。只在真的写出了截图时才写——没有图却有标记，会让下游以为图丢了。
  if (length(written_charts) > 0) {
    writeLines(as.character(EXPORT_CONTRACT_VERSION), file.path(charts_dir, ".export-contract"))
  }

  # --- 4. 打包 ZIP（保留 ab1_files/ charts/ analysis_summary/ 子目录结构）---
  safe_template <- gsub("[^A-Za-z0-9._-]+", "_", template_name %||% "results")
  zip_name <- paste0("results_", safe_template, "_", format(Sys.time(), "%Y%m%d"), ".zip")
  zip_path <- file.path(session_dir, zip_name)

  old_wd <- setwd(zip_work_dir)
  tryCatch({
    # 只打包非空的子目录
    subdirs <- c("ab1_files", "charts", "analysis_summary")
    subdirs <- subdirs[vapply(subdirs, function(d) length(list.files(d)) > 0, logical(1))]
    create_zip_archive(zip_path, subdirs, recurse = TRUE)
  }, finally = {
    setwd(old_wd)
  })

  zip_path
}

# 批内文件名去重（保留 .ab1 扩展名）：同名追加 _1/_2...，返回与输入等长、按输入顺序。
dedup_basenames <- function(names) {
  used <- character(0); out <- character(length(names))
  for (i in seq_along(names)) {
    nm <- basename(names[i]); cand <- nm
    if (cand %in% used) {
      base <- tools::file_path_sans_ext(nm); ext <- tools::file_ext(nm); k <- 1
      repeat { cand <- paste0(base, "_", k, if (nzchar(ext)) paste0(".", ext) else ""); if (!(cand %in% used)) break; k <- k + 1 }
    }
    used <- c(used, cand); out[i] <- cand
  }
  out
}

# 把可能被 JSON 解析成数组/list 的字段强制转成单个字符串标量。
# 前端会把 plumber 序列化出的 ["xxx"] 原样回传，若直接用作 env 的 key
# 会触发 "wrong args for environment subassignment"。
as_scalar_chr <- function(x) {
  if (is.null(x)) return(NULL)
  v <- as.character(unlist(x))
  if (length(v) == 0) NULL else v[[1]]
}
