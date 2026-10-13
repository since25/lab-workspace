# R/analysis.R
# 核心序列分析函数 - 从 global.R 提取

# 加载必要的包
library(magrittr)
library(dplyr)
library(Biostrings)
library(sangerseqR)
library(gamlss)

#' 反向互补序列
#' @param x DNA 序列字符串
#' @return 反向互补后的字符串
revcom <- function(x) {
  as.character(Biostrings::reverseComplement(Biostrings::DNAString(x)))
}

# pwalign 在 Bioconductor 3.19 / R 4.4 后才从 Biostrings 拆分成独立包。
# 部署服务器上是 R 4.3.3 + Biostrings 2.70.1，没有 pwalign，但 Biostrings 仍原生
# 自带 pairwiseAlignment。这里做兼容回退：有 pwalign 用 pwalign，缺失则回退到
# Biostrings（两者返回的比对对象结构一致：@subject@range@start/width）。
# 否则本地（有 pwalign）正常、服务器（无 pwalign）会所有分析失败。
.pairwiseAlignment <- function(...) {
  if (requireNamespace("pwalign", quietly = TRUE)) {
    pwalign::pairwiseAlignment(...)
  } else {
    Biostrings::pairwiseAlignment(...)
  }
}
.alignmentScore <- function(alignment) {
  if (requireNamespace("pwalign", quietly = TRUE)) {
    pwalign::score(alignment)
  } else {
    Biostrings::score(alignment)
  }
}

#' 匹配 guide 序列位置
#' @param guide guide RNA 序列（DNAString 对象）
#' @param input.seq 主序列（DNAString 对象）
#' @return list(match, start, end) - 匹配方向和坐标
GetGuideMatch <- function(guide, input.seq) {
  guide.len <- length(guide)
  subject.len <- length(input.seq)

  align.f <- .pairwiseAlignment(
    pattern = guide, subject = input.seq, type = "overlap"
  )
  align.r <- .pairwiseAlignment(
    pattern = Biostrings::reverseComplement(guide),
    subject = input.seq, type = "overlap"
  )

  build_guide_coord <- function(alignment, match_label) {
    subject.start <- alignment@subject@range@start
    subject.width <- alignment@subject@range@width
    pattern.start <- alignment@pattern@range@start
    pattern.width <- alignment@pattern@range@width
    guide.coord <- list(
      match = match_label,
      start = subject.start,
      end = subject.start + subject.width - 1,
      matched_width = pattern.width,
      score = .alignmentScore(alignment)
    )

    if ((guide.coord$end - guide.coord$start + 1) != guide.len) {
      startdiff <- 1 - pattern.start
      enddiff <- guide.len - (pattern.start + pattern.width - 1)
      guide.coord$start <- guide.coord$start + startdiff
      guide.coord$end <- guide.coord$end + enddiff
    }

    guide.coord$start <- max(1, guide.coord$start)
    guide.coord$end <- min(subject.len, guide.coord$end)
    guide.coord
  }

  guide.coord.f <- build_guide_coord(align.f, "forward")
  guide.coord.r <- build_guide_coord(align.r, "reverse")

  if (guide.coord.f$matched_width <= 1 && guide.coord.r$matched_width <= 1) {
    stop("Failed to find a guide match in either forward or reverse orientation.")
  }

  if (guide.coord.r$matched_width > guide.coord.f$matched_width) {
    guide.coord <- guide.coord.r
  } else if (guide.coord.r$matched_width < guide.coord.f$matched_width) {
    guide.coord <- guide.coord.f
  } else if (guide.coord.r$score > guide.coord.f$score) {
    guide.coord <- guide.coord.r
  } else {
    guide.coord <- guide.coord.f
  }

  guide.coord$matched_width <- NULL
  guide.coord$score <- NULL
  return(guide.coord)
}

#' 创建 Sanger 测序数据框
#' @param peakAmp 峰振幅矩阵
#' @param basecalls 碱基调用结果
#' @return data.frame
CreateSangs <- function(peakAmp, basecalls) {
  sangs <- as.data.frame(peakAmp)
  names(sangs) <- c("A.area", "C.area", "G.area", "T.area")

  sangs <- sangs %>%
    dplyr::mutate(
      Tot.area = A.area + C.area + G.area + T.area,
      A.perc = 100 * A.area / Tot.area,
      C.perc = 100 * C.area / Tot.area,
      G.perc = 100 * G.area / Tot.area,
      T.perc = 100 * T.area / Tot.area
    )

  sangs$base.call <- strsplit(x = toString(basecalls@primarySeq), split = "") %>%
    unlist()

  sangs$index <- seq_along(sangs$base.call)
  return(sangs)
}

#' 拟合零调整伽马分布噪声模型
#' @param sangs.filt 过滤后的 Sanger 数据框
#' @param guide.coord guide 坐标信息
#' @return list of data.frames with ZAGA parameters
GetNullDistModel <- function(sangs.filt, guide.coord) {
  sangs.filt <- sangs.filt %>%
    dplyr::filter(!(index %in% (guide.coord$start:guide.coord$end)))

  nvals <- list()
  nvals$t <- sangs.filt %>% dplyr::filter(base.call != "T") %>% dplyr::select(T.perc) %>% unlist()
  nvals$c <- sangs.filt %>% dplyr::filter(base.call != "C") %>% dplyr::select(C.perc) %>% unlist()
  nvals$g <- sangs.filt %>% dplyr::filter(base.call != "G") %>% dplyr::select(G.perc) %>% unlist()
  nvals$a <- sangs.filt %>% dplyr::filter(base.call != "A") %>% dplyr::select(A.perc) %>% unlist()

  replacement_zaga <- c(
    rep(0, 989), 0.00998720389310502, 0.00998813447664401, 0.009992887520785,
    0.00999585366068316, 0.00999623914632598, 0.00999799013526835, 0.010001499423723,
    0.0100030237039207, 0.0100045782875701, 0.0100048452355807, 0.0100049548867042
  )

  n.models <- lapply(nvals, FUN = function(x) {
    set.seed(1)
    if ((unique(x)[1] == 0 & length(unique(x)) == 1) |
      (unique(x)[1] == 0 & length(unique(x)) == 2 & table(x)[2] == 1)) {
      x <- replacement_zaga
      message("Replacement vector used for low noise.")
    }
    tryCatch(
      gamlss::gamlss((x) ~ 1, family = gamlss.dist::ZAGA),
      error = function(e) tryCatch(
        gamlss::gamlss((x) ~ 1, family = gamlss.dist::ZAGA, mu.start = 1),
        error = function(e) tryCatch(
          gamlss::gamlss((x) ~ 1, family = gamlss.dist::ZAGA, mu.start = 2),
          error = function(e) tryCatch(
            gamlss::gamlss((x) ~ 1, family = gamlss.dist::ZAGA, mu.start = 3),
            error = function(e) gamlss::gamlss((x) ~ 1, family = gamlss.dist::ZAGA, mu.start = mean(x))
          )
        )
      )
    )
  })

  null.m.params <- lapply(n.models, FUN = function(x) {
    mu <- exp(x$mu.coefficients[[1]])
    sigma <- exp(x$sigma.coefficients[[1]])
    nu.logit <- x$nu.coefficients[[1]]
    nu <- exp(nu.logit) / (1 + exp(nu.logit))
    fillibens <- cor(as.data.frame(qqnorm(x$residuals, plot = FALSE)))[1, 2]
    return(data.frame(mu = mu, sigma = sigma, nu = nu, fillibens = fillibens))
  })

  return(null.m.params)
}

#' 创建编辑结果数据框
#' @param guide.coord guide 坐标
#' @param guide guide 序列
#' @param sangs 完整 Sanger 数据框
#' @param null.m.params 噪声模型参数
#' @return data.frame
CreateEditingDF <- function(guide.coord, guide, sangs, null.m.params) {
  guide.df <- sangs[guide.coord$start:guide.coord$end, ]

  normalize_reverse_orientation <- function(df) {
    df <- df[nrow(df):1, , drop = FALSE]
    a.area <- df$A.area
    c.area <- df$C.area
    g.area <- df$G.area
    t.area <- df$T.area
    a.perc <- df$A.perc
    c.perc <- df$C.perc
    g.perc <- df$G.perc
    t.perc <- df$T.perc
    df$A.area <- t.area
    df$C.area <- g.area
    df$G.area <- c.area
    df$T.area <- a.area
    df$A.perc <- t.perc
    df$C.perc <- g.perc
    df$G.perc <- c.perc
    df$T.perc <- a.perc
    df$base.call <- strsplit(revcom(paste(df$base.call, collapse = "")), "")[[1]]
    df
  }

  normalize_null_params <- function(params) {
    list(
      t = params$a,
      c = params$g,
      g = params$c,
      a = params$t
    )
  }

  if (identical(guide.coord$match, "reverse")) {
    guide.df <- normalize_reverse_orientation(guide.df)
    null.m.params <- normalize_null_params(null.m.params)
  }

  guide.df$guide.seq <- guide %>% toString() %>% strsplit(., "") %>% unlist()

  calcBaseProb <- function(params, perc) {
    outprobs <- gamlss.dist::pZAGA(
      q = perc,
      mu = params$mu,
      sigma = params$sigma,
      nu = params$nu,
      lower.tail = FALSE
    )
  }

  guide.df$T.pval <- calcBaseProb(params = null.m.params$t, perc = guide.df$T.perc)
  guide.df$C.pval <- calcBaseProb(params = null.m.params$c, perc = guide.df$C.perc)
  guide.df$G.pval <- calcBaseProb(params = null.m.params$g, perc = guide.df$G.perc)
  guide.df$A.pval <- calcBaseProb(params = null.m.params$a, perc = guide.df$A.perc)

  guide.df$guide.position <- seq_along(guide.df$guide.seq)

  editing.df <- guide.df
  return(editing.df)
}

#' 生成编辑率柱状图
#' @param edit.long 长格式编辑数据
#' @param null.m.params 噪声模型参数
#' @param base 目标碱基
#' @param pval p 值阈值
#' @param editing.df 编辑数据框
#' @return ggplot 对象
makeEditingBarPlot <- function(edit.long, null.m.params, base, pval, editing.df) {
  cutoff.line <- gamlss.dist::qZAGA(
    p = pval, mu = null.m.params$mu,
    sigma = null.m.params$sigma,
    nu = null.m.params$nu, lower.tail = FALSE
  )

  edit.filt <- edit.long %>% dplyr::filter(guide.seq != base, focal.base == base)

  edit.filt %>%
    dplyr::filter(measure == "perc") %>%
    ggplot2::ggplot(ggplot2::aes(x = guide.position, y = value)) +
    ggplot2::geom_bar(stat = "identity") +
    ggplot2::scale_y_continuous(breaks = seq(0, 100, 10)) +
    ggplot2::coord_cartesian(ylim = c(0, 100)) +
    ggplot2::scale_x_continuous(breaks = seq_along(editing.df$guide.seq)) +
    ggplot2::annotate(
      geom = "segment", x = 0, xend = length(editing.df$guide.seq),
      y = cutoff.line, yend = cutoff.line
    ) +
    ggplot2::labs(
      title = paste0("Percent ", base, " editing"),
      x = "Base postion in guide RNA",
      y = "Percent Total peak area"
    ) +
    ggplot2::theme(axis.text.x = ggplot2::element_text(size = 8))
}

#' guide 上下游各看多少位（2026-09-23 用户定：上下游各约 50 bp，只为分析时瞄一眼）
FLANK_BP <- 50L

#' guide 上下游各 flank 位的读值，**按 guide 方向**给出
#'
#' 整条 ab1 本来就读进来了，框外的位置此前只拿去拟合噪声模型、用完就扔。这里把紧挨 guide
#' 两侧的读值留下来，让人看一眼有没有不该出现的混峰。只给占比、**不判显著**：框外这些位置
#' 正是噪声模型的背景，拿它们自己判显著等于自己给自己当对照。
#'
#' - Offset：-50..-1 是 guide 5' 端上游，1..50 是 3' 端下游（按 guide 自己的方向）。
#'   guide 贴反链时读段坐标倒过来走、碱基取互补，与 CreateEditingDF 同一口径。
#' - 读段两头质量差（getEditing 滤掉的前 20 位、峰面积过低的位）或超出读段 → 这一行的读值全是 NA，
#'   是「未测」不是 0。
#' - Non_Major_Rate = 100 - 主峰占比：混峰有多重。Minor_Base 是第二高的那个碱基。
#' @param sangs CreateSangs 的整条读段
#' @param guide.coord GetGuideMatch 的结果（match / start / end，读段坐标）
#' @param measured_idx 视为读得准的读段下标（getEditing 过滤后的 sangs.filt$index）
#' @return data.frame，固定 2 * flank 行
BuildFlankDF <- function(sangs, guide.coord, measured_idx, flank = FLANK_BP) {
  n <- nrow(sangs)
  reverse <- identical(guide.coord$match, "reverse")
  comp <- c(A = "T", C = "G", G = "C", T = "A")
  offsets <- c(-(flank:1), seq_len(flank))
  rows <- lapply(offsets, function(k) {
    idx <- if (!reverse) {
      if (k < 0) guide.coord$start + k else guide.coord$end + k
    } else {
      if (k < 0) guide.coord$end - k else guide.coord$start - k
    }
    empty <- data.frame(Offset = k, Read_Base = NA_character_, Top_Base = NA_character_,
                        A = NA_real_, C = NA_real_, G = NA_real_, T = NA_real_,
                        Minor_Base = NA_character_, Non_Major_Rate = NA_real_,
                        stringsAsFactors = FALSE)
    if (idx < 1 || idx > n || !(idx %in% measured_idx)) return(empty)
    r <- sangs[idx, ]
    p <- c(A = r$A.perc, C = r$C.perc, G = r$G.perc, T = r$T.perc)
    if (any(!is.finite(p))) return(empty)
    call <- as.character(r$base.call)
    if (reverse) {
      p <- c(A = p[["T"]], C = p[["G"]], G = p[["C"]], T = p[["A"]])
      call <- if (call %in% names(comp)) comp[[call]] else call
    }
    ord <- order(p, decreasing = TRUE)
    data.frame(Offset = k, Read_Base = call, Top_Base = names(p)[ord[1]],
               A = round(p[["A"]], 2), C = round(p[["C"]], 2),
               G = round(p[["G"]], 2), T = round(p[["T"]], 2),
               Minor_Base = names(p)[ord[2]], Non_Major_Rate = round(100 - p[[ord[1]]], 2),
               stringsAsFactors = FALSE)
  })
  do.call(rbind, rows)
}

#' 主分析函数 - 处理单个 .ab1 文件
#' @param ab1file .ab1 文件路径
#' @param exampleguide guide 序列字符串
#' @param outputF 输出 CSV 文件路径（NA 则不写入）
#' @param trim3 3' 修剪位置
#' @param trim5 5' 修剪位置
#' @return 编辑结果数据框
getEditing <- function(ab1file, exampleguide, outputF = NA, trim3 = NA, trim5 = NA) {
  cat("=========================================================================\n")
  cat("开始分析", ab1file, "。\n")

  input.seq <- sangerseqR::readsangerseq(ab1file)
  input.basecalls <- sangerseqR::makeBaseCalls(input.seq)
  guide <- Biostrings::DNAString(exampleguide)
  input.peakampmatrix <- sangerseqR::peakAmpMatrix(input.basecalls)
  sangs <- CreateSangs(input.peakampmatrix, input.basecalls)

  # 过滤
  if (is.na(trim3) & is.na(trim5)) {
    sangs.filt <- sangs %>% dplyr::filter(index > 20)
    peakTotAreaCutoff <- mean(sangs.filt$Tot.area) / 10
    sangs.filt <- sangs.filt %>% dplyr::filter(Tot.area > peakTotAreaCutoff)
  } else {
    sangs.filt <- sangs[trim5:trim3, ]
  }

  # 匹配 guide 位置
  filt.sequence <- sangs.filt$base.call %>% paste(collapse = "") %>% Biostrings::DNAString()
  guide.match <- GetGuideMatch(guide, filt.sequence)
  guide.coord <- list(
    match = guide.match$match,
    start = sangs.filt[guide.match$start, "index"],
    end = sangs.filt[guide.match$end, "index"]
  )

  # 拟合噪声模型
  invisible(capture.output(
    null.m.params <- GetNullDistModel(sangs.filt, guide.coord),
    type = "output"
  ))

  # 计算编辑结果
  editing.df <- CreateEditingDF(guide.coord, guide, sangs, null.m.params)
  # guide 上下游各 FLANK_BP 位的读值，挂在属性上随行带出，editing.df 本身一列不动。
  # 只给人「瞄一眼框外有没有异常峰」，不进推给 Hub 的载荷；算不出来也不许拖垮主分析。
  attr(editing.df, "flank") <- tryCatch(
    BuildFlankDF(sangs, guide.coord, measured_idx = sangs.filt$index),
    error = function(e) NULL
  )

  if (!is.na(outputF)) {
    utils::write.csv(editing.df, outputF)
    cat("输出结果至 ", outputF, "。\n")
  }

  cat("结束分析", ab1file, "。\n")
  cat("=========================================================================\n\n")

  return(editing.df)
}

#' 从 CSV 提取目标位点指标
#' @param csv_file CSV 文件路径
#' @param target_positions 目标位置向量
#' @param metrics 指标列名向量
#' @param output_columns 输出列名向量
#' @param target_base 目标碱基
#' @param edited_base 编辑后碱基
#' @param target_metric 目标碱基指标列名
#' @param edited_metric 编辑后碱基指标列名
#' @param file_name 文件名
#' @return data.frame
extract_target_metrics <- function(csv_file, target_positions, metrics, output_columns,
                                   target_base, edited_base, target_metric, edited_metric,
                                   file_name) {
  data <- utils::read.csv(csv_file, header = TRUE, stringsAsFactors = FALSE)
  if (!("guide.position" %in% names(data))) {
    stop("结果文件缺少 guide.position 列。")
  }
  if (!all(metrics %in% names(data))) {
    stop("结果文件缺少目标比例列。")
  }

  metric_labels <- c("A", "C", "G", "T")
  row_result <- vector("list", length(output_columns))
  names(row_result) <- output_columns
  row_result[["Target_Base"]] <- target_base
  row_result[["Edited_Base"]] <- edited_base
  col_counter <- 3

  for (target_position in target_positions) {
    row_data <- data[data$guide.position == target_position, , drop = FALSE]
    ref_value <- if (nrow(row_data) == 0) NA_real_ else as.numeric(row_data[[target_metric]][1])
    edit_value <- if (nrow(row_data) == 0) NA_real_ else as.numeric(row_data[[edited_metric]][1])
    edit_rate_value <- edit_value
    non_target_edit_rate_value <- if (is.na(ref_value)) NA_real_ else 100 - ref_value
    row_result[[col_counter]] <- ref_value
    row_result[[col_counter + 1]] <- edit_value
    row_result[[col_counter + 2]] <- edit_rate_value
    row_result[[col_counter + 3]] <- non_target_edit_rate_value
    col_counter <- col_counter + 4
    for (metric_name in metrics) {
      row_result[[col_counter]] <- if (nrow(row_data) == 0) NA_real_ else as.numeric(row_data[[metric_name]][1])
      col_counter <- col_counter + 1
    }
  }

  row_result[[length(output_columns)]] <- file_name
  as.data.frame(row_result, stringsAsFactors = FALSE)
}
