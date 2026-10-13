# R/nanopore.R
# 纳米孔测序交付包的解析：拆包 → 归一方向 → 取 guide 窗口里每一位的读值。
#
# 2026-09-20 从 Hub（daily-workflow）的 `nanopore_package.py` 逐条搬过来。
# 理由是「Hub 是承接方」：拆包、定窗口、逐位点读值是加工，属于分析侧；
# Hub 只负责派发、存表、看得见归属。
#
# ## 这一层只做解析，不碰会话、不碰数据库
#
# 给它一个解开的交付包目录和一支 guide 的位点声明，它返回结构化的结果。
# 出 summary / heatmap / raw 三张表的整形在本文件末尾，落盘与推送在别处。
#
# ## 要的是什么（用户 2026-09-19）
#
# 纳米孔回来的结果，关注的是**在 guide 序列上**、尤其是 **target**、以及
# **bystander / candidate 那一块**的 `edit from → edit to` 的数据。
# 所以产出就两样：每个样本一行摘要；guide 窗口里逐位点一行。
#
# 注意 一致性序列头里的 `ratio` / `complete` / `sus` / `num` / `len` **一个都不收**。
# 那是测序厂商的质控元数据，不是用户要记录的数据。读到不等于要存。
#
# ## 注意 三个坑，三步各用各的依据，一个都不能省
#
# | 步 | 用什么 | 省了会怎样 |
# |---|---|---|
# | ① 定窗口坐标 | 在**任意一个匹配得上的样本**上定**一次** | 逐样本精确匹配会在编辑最彻底的样本上失败 |
# | ② 定每个样本的方向 | **整条一致性序列**正反各比一次 | 只比那 20 位，样本量太小且其中一位会变 |
# | ③ 取频率表那一行 | 反向交付的要**镜像行号**，碱基身份跟着翻 | 取到一个完全无关的位置，**而且不报错** |
#
# ① 2026-09-19 在真包上实测：拿 guide 那 20 nt 去每个样本里精确匹配，19 个里 8 个
#   找不到——目标位就在那 20 个碱基里，编辑到 100% 的样本那一位已经从 C 变成 T。
#   「找不到窗口」和「编辑率 100%」在结果里长得一模一样。同一订单扩增子是同一条，
#   坐标是常数，所以定一次、所有样本共用。
# ③ 同一个物理位点上的 C→T，在反向互补交付的样本里表现为 G→A。只镜像行号、
#   不翻碱基，会去读一个恒为 0 的计数列——看起来就是「这个样本没编辑」。
#   注意 2026-09-21 补：这两件事**判据不同**。行号镜像按「相对锚样本」，碱基翻身按
#   「相对设计序列」。锚自己反向交付时两者不相等，合成一个用会整批读到互补碱基。
#   见 `nano_read_site` 与 `docs/nanopore-strand-fix.md`。
#
# ## 多扩增子（波 2 那道闸门要堵的事）
#
# 一管里测两个目标 = 同一个样本目录按两支 guide **各跑一遍**，各自定窗口。
# Hub 侧此前整包只定一次窗口，第二个扩增子长度碰巧相同时会静默算错；
# 这里按「检测」分组跑，那个坑就不存在了。见 `nano_analyze_rows`。

`%||%` <- function(x, y) if (is.null(x) || length(x) == 0) y else x

#: 一个样本目录下，解析要用到的子目录。其余（fastq / QC / ab1）是附件。
#: 2026-10-13 起 `Bam/` 是逐位点读值的主源，频率表降为校验与兜底，见 `docs/nanopore-data-source.md`。
NANO_SEQ_DIR <- "Sequences"
NANO_FREQ_DIR <- "Frequency_tables"
NANO_SUS_DIR <- "Suspious_sites"   # 注意 上游拼错了（少个 i），照抄，别「顺手修正」
NANO_BAM_DIR <- "Bam"

#: indel 超过这个比例就**浮现**出来让人看一眼。
#: 注意 这不是「这是真实 indel」的判据（用户 2026-09-19）。判定由人做：碱基编辑里
#: indel 是副产物、本来就低；传统 Cas9 一般要到 80% 以上。同一个 3% 含义正好相反。
NANO_INDEL_SURFACE_THRESHOLD <- 0.05

nano_reverse_complement <- function(sequence) {
  sequence <- as.character(sequence %||% "")
  if (!nzchar(sequence)) return("")
  chars <- strsplit(sequence, "", fixed = TRUE)[[1]]
  paste(rev(chartr("ACGTNacgtn", "TGCANtgcan", chars)), collapse = "")
}

# ── 位点声明 ─────────────────────────────────────────────────────────────

# 从一支 guide 料上取来的位点声明。**位点模型就是这两格**（用户 2026-09-19 拍板不扩）：
# 目标位是人设计时定的，旁观位可有可无。窗口里其余每一位不需要声明——它们是测出来的。
nano_guide_spec <- function(design_sequence, target_site, edit_from, edit_to,
                            bystander_site = NULL) {
  design <- toupper(trimws(as.character(design_sequence %||% "")))
  if (!nzchar(design)) stop("这支料没有设计序列，定不出 guide 窗口在哪。")
  site <- suppressWarnings(as.integer(target_site))
  if (length(site) != 1 || is.na(site) || site < 1 || site > nchar(design)) {
    stop(sprintf("目标位第 %s 位落在设计序列之外（长 %d nt）。",
                 as.character(target_site %||% "?"), nchar(design)))
  }
  bys <- NULL
  if (!is.null(bystander_site) && nzchar(as.character(bystander_site))) {
    bys <- suppressWarnings(as.integer(bystander_site))
    if (is.na(bys)) bys <- NULL
    else if (bys < 1 || bys > nchar(design)) stop(sprintf("旁观位第 %d 位落在设计序列之外。", bys))
  }
  from <- toupper(trimws(as.character(edit_from %||% "")))
  to <- toupper(trimws(as.character(edit_to %||% "")))
  if (!nzchar(from) || !nzchar(to)) stop("这支料没写编辑方向（edit_from / edit_to），算不出编辑率。")
  list(design_sequence = design, target_site = site, edit_from = from, edit_to = to,
       bystander_site = bys)
}

# ── 读文件 ───────────────────────────────────────────────────────────────

# 一致性序列。**头一行那几个字段一个都不收**，见文件头。
nano_read_consensus <- function(path) {
  lines <- readLines(path, warn = FALSE, encoding = "UTF-8")
  lines <- trimws(lines)
  lines <- lines[nzchar(lines) & !startsWith(lines, ">")]
  toupper(paste(lines, collapse = ""))
}

# 频率表 / 可疑位点表 → data.frame（全字符列）。空文件 → 0 行。
#
# 注意 **按表头判分隔符，不按扩展名。** 同一个包里两种混用——真包实测 19 个样本里
# 10 个是制表符、9 个是逗号，而扩展名全是 `.csv`。
# 注意 表头第一列是 `#Clust`，那个 `#` 要去掉，否则列名对不上。
#
# 注意 文件不以换行结尾 = 最后一行是半行（厂商打包截断过，2026-10-13 实测断在 4 KiB 边界），
# 那半行的计数不可信，丢掉。
nano_read_table <- function(path) {
  raw <- readLines(path, warn = FALSE, encoding = "UTF-8")
  size <- file.info(path)$size
  if (length(raw) > 0 && !is.na(size) && size > 0) {
    con <- file(path, "rb")
    seek(con, size - 1)
    last <- readBin(con, "raw", 1)
    close(con)
    if (!identical(last, as.raw(0x0a))) raw <- raw[-length(raw)]
  }
  raw <- raw[nzchar(trimws(raw))]
  if (length(raw) == 0) return(data.frame())
  delimiter <- if (grepl("\t", raw[1], fixed = TRUE)) "\t" else ","
  df <- utils::read.table(text = raw, sep = delimiter, header = TRUE, quote = "\"",
                          comment.char = "", colClasses = "character",
                          check.names = FALSE, stringsAsFactors = FALSE,
                          fill = TRUE, na.strings = character(0))
  names(df) <- trimws(sub("^#", "", names(df)))
  df
}

nano_only_file <- function(directory, suffix) {
  if (!dir.exists(directory)) return(NULL)
  hits <- sort(list.files(directory, pattern = paste0("\\", suffix, "$"), full.names = TRUE))
  hits <- hits[file.exists(hits) & !dir.exists(hits)]
  if (length(hits) == 0) NULL else hits[1]
}

# ── BAM：逐位点读值的主源 ─────────────────────────────────────────────────
#
# 厂商已经把每管的读比对回这管自己的一致性序列（minimap2），所以 BAM 的 1-based 位置
# = fasta / 频率表的行号，后面的定窗口、镜像行号、翻碱基一行不用改。
# 2026-10-13 真包实测 56/56 管：按下面的口径逐位点累计，与频率表 Depth / A~T / Del / Ins
# **逐格相等**；频率表被截断的 4 管 BAM 照样完整。
#
# 纯 R、零依赖：BGZF 就是多段 gzip 拼接，`gzfile()` 会顺着读完所有段。
# 注意 不能用 `memDecompress(type = "gzip")`——它只解第一段（实测 400 KB 的 BAM 只读出 1 KB）。
# 注意 `.bai` 不用：厂商给的是极简索引，按坐标随机查不可靠；整份顺序读也就几百 KB。
#
# 计数口径（与频率表一致，实测对过）：
#   M / = / X 记碱基（非 ACGT 的碱基只进深度）；D / N 记缺失；
#   I 记在插入**之后**那一位（记在之前那一位，每管有 10%–25% 的位点对不上）；S / H 只推进读段。
#   深度 = A + C + G + T + 缺失（+ 非 ACGT），插入不进深度。
#   跳过 flag & 0x904（未比对 / secondary / supplementary）。

nano_bam_le <- function(bytes, offset, n = 1L) {
  readBin(bytes[offset + seq_len(4L * n)], "integer", n = n, size = 4L, endian = "little")
}

# 读一份 BAM，返回与频率表同形的 data.frame（一行一位）：Depth / A_num … Ins_num。
# 解析不了、或参考不止一条时 stop()，调用方据此回退到频率表。
nano_read_bam <- function(path) {
  con <- gzfile(path, "rb")
  chunks <- list()
  repeat {
    piece <- readBin(con, "raw", n = 4e6)
    if (length(piece) == 0) break
    chunks[[length(chunks) + 1L]] <- piece
  }
  close(con)
  b <- unlist(chunks, use.names = FALSE)
  if (length(b) < 12 || !identical(b[1:4], as.raw(c(0x42, 0x41, 0x4d, 0x01)))) stop("不是 BAM 文件")
  o <- 4L
  l_text <- nano_bam_le(b, o); o <- o + 4L + l_text
  n_ref <- nano_bam_le(b, o); o <- o + 4L
  if (n_ref != 1L) stop(sprintf("BAM 里有 %d 条参考序列，预期 1 条", n_ref))
  l_name <- nano_bam_le(b, o); o <- o + 4L + l_name
  ref_len <- nano_bam_le(b, o); o <- o + 4L
  if (is.na(ref_len) || ref_len <= 0) stop("BAM 头里的参考长度不对")

  # 全部读段的落点先攒起来，最后一次性计数。
  base_pos <- list(); base_code <- list(); del_pos <- list(); ins_pos <- list()
  nibble <- c(NA, 1L, 2L, NA, 3L, NA, NA, NA, 4L, NA, NA, NA, NA, NA, NA, NA)  # =ACMGRSVTWYHKDBN → A1 C2 G3 T4
  total <- length(b)
  while (o + 4L <= total) {
    block <- nano_bam_le(b, o)
    if (is.na(block) || block < 32L || o + 4L + block > total) stop("BAM 记录不完整")
    fixed <- nano_bam_le(b, o + 4L, 8L)
    ref_id <- fixed[1]; pos <- fixed[2]
    l_read_name <- as.integer(b[o + 4L + 9L])
    n_cigar <- readBin(b[o + 4L + 13:14], "integer", size = 2L, signed = FALSE, endian = "little")
    flag <- readBin(b[o + 4L + 15:16], "integer", size = 2L, signed = FALSE, endian = "little")
    l_seq <- fixed[5]
    q <- o + 4L + 32L + l_read_name
    next_o <- o + 4L + block
    o <- next_o
    if (ref_id != 0L || bitwAnd(flag, 0x904L) != 0L || n_cigar == 0L) next
    cigar <- nano_bam_le(b, q, n_cigar); q <- q + 4L * n_cigar
    ops <- bitwAnd(cigar, 15L)
    lens <- bitwShiftR(cigar, 4L)
    packed <- as.integer(b[q + seq_len((l_seq + 1L) %/% 2L)])
    codes <- nibble[as.vector(rbind(bitwShiftR(packed, 4L), bitwAnd(packed, 15L)))[seq_len(l_seq)] + 1L]
    codes[is.na(codes)] <- 5L
    ref_step <- ifelse(ops %in% c(0L, 2L, 3L, 7L, 8L), lens, 0L)
    qry_step <- ifelse(ops %in% c(0L, 1L, 4L, 7L, 8L), lens, 0L)
    ref_at <- pos + c(0L, cumsum(ref_step))[seq_along(ops)]   # 0-based
    qry_at <- c(0L, cumsum(qry_step))[seq_along(ops)]
    m <- ops %in% c(0L, 7L, 8L)
    if (any(m)) {
      base_pos[[length(base_pos) + 1L]] <- sequence(lens[m], from = ref_at[m] + 1L)
      base_code[[length(base_code) + 1L]] <- codes[sequence(lens[m], from = qry_at[m] + 1L)]
    }
    d <- ops %in% c(2L, 3L)
    if (any(d)) del_pos[[length(del_pos) + 1L]] <- sequence(lens[d], from = ref_at[d] + 1L)
    ins <- ops == 1L
    if (any(ins)) ins_pos[[length(ins_pos) + 1L]] <- ref_at[ins] + 1L
  }
  bp <- c(integer(0), unlist(base_pos)); bc <- c(integer(0), unlist(base_code))
  keep <- bp >= 1L & bp <= ref_len
  bases <- matrix(tabulate((bc[keep] - 1L) * ref_len + bp[keep], nbins = 5L * ref_len), ncol = 5L)
  in_range <- function(p) { p <- c(integer(0), unlist(p)); p[p >= 1L & p <= ref_len] }
  del <- tabulate(in_range(del_pos), nbins = ref_len)
  data.frame(
    Position = seq_len(ref_len),
    Depth = rowSums(bases) + del,
    A_num = bases[, 1], C_num = bases[, 2], G_num = bases[, 3], T_num = bases[, 4],
    Del_num = del, Ins_num = tabulate(in_range(ins_pos), nbins = ref_len)
  )
}

# 频率表相对 BAM（或相对一致性序列长度）有什么毛病。没毛病返回 ""。
# 这是**数据瑕疵**（厂商派生文件坏了，可要求重发），不是样本问题。
nano_frequency_defect <- function(frequency, amplicon_length, bam = NULL) {
  if (is.null(frequency) || nrow(frequency) == 0) return("厂商交付的频率表是空文件")
  if (nrow(frequency) < amplicon_length) {
    return(sprintf("厂商交付的频率表疑似截断（只有 %d 行 / 共 %d 行）", nrow(frequency), amplicon_length))
  }
  if (is.null(bam)) return("")
  rows <- seq_len(min(nrow(frequency), nrow(bam)))
  cols <- c("Depth", "A_num", "C_num", "G_num", "T_num", "Del_num", "Ins_num")
  if (!all(cols %in% names(frequency))) return("厂商交付的频率表缺列，无法与 BAM 核对")
  differ <- vapply(rows, function(i) {
    any(suppressWarnings(as.integer(unlist(frequency[i, cols]))) != unlist(bam[i, cols]), na.rm = TRUE)
  }, logical(1))
  if (any(differ)) sprintf("厂商交付的频率表与 BAM 计数不一致（%d 个位点）", sum(differ)) else ""
}

# 槽位号排序：数字的按数值、其余按字面。`"9"` 要排在 `"27"` 前面，按字符串排会反。
nano_sort_slots <- function(slots) {
  numeric <- grepl("^[0-9]+$", slots)
  c(slots[numeric][order(as.integer(slots[numeric]))], sort(slots[!numeric]))
}

# 把解开的交付包读成一串样本。`root` 是**订单目录**（里面一个样本一个子目录）。
# 每个样本：list(slot, consensus, frequency = data.frame, suspicious = data.frame,
#               source = "BAM" | "频率表", data_note)。
# `frequency` 是逐位点读值：有可用的 BAM 就是 BAM 算出来的那份，否则是频率表原样。
# `data_note` 记频率表的瑕疵（截断 / 空文件 / 与 BAM 不符）或 BAM 用不上的原因，不影响能不能读。
#
# 注意 包里没有任何订单级的清单（无 README、无样品对照表），样本身份只能从目录名解析。
nano_read_package <- function(root) {
  if (!dir.exists(root)) stop(sprintf("找不到交付包目录：%s", root))
  dirs <- list.dirs(root, recursive = FALSE, full.names = FALSE)
  samples <- list()
  for (slot in nano_sort_slots(dirs)) {
    directory <- file.path(root, slot)
    seq_file <- nano_only_file(file.path(directory, NANO_SEQ_DIR), ".fasta")
    if (is.null(seq_file)) next
    freq_file <- nano_only_file(file.path(directory, NANO_FREQ_DIR), ".csv")
    sus_file <- nano_only_file(file.path(directory, NANO_SUS_DIR), ".csv")
    bam_file <- nano_only_file(file.path(directory, NANO_BAM_DIR), ".bam")
    consensus <- nano_read_consensus(seq_file)
    frequency <- if (is.null(freq_file)) data.frame() else nano_read_table(freq_file)
    bam <- NULL
    bam_note <- ""
    if (!is.null(bam_file)) {
      bam <- tryCatch(nano_read_bam(bam_file), error = function(e) e)
      if (inherits(bam, "error")) {
        bam_note <- sprintf("BAM 解析失败（%s），改用频率表", conditionMessage(bam))
        bam <- NULL
      } else if (nrow(bam) != nchar(consensus)) {
        bam_note <- sprintf("BAM 参考长 %d nt，与一致性序列 %d nt 不符，改用频率表", nrow(bam), nchar(consensus))
        bam <- NULL
      }
    }
    notes <- c(bam_note, nano_frequency_defect(frequency, nchar(consensus), bam))
    samples[[length(samples) + 1]] <- list(
      slot = slot,
      consensus = consensus,
      frequency = if (is.null(bam)) frequency else bam,
      suspicious = if (is.null(sus_file)) data.frame() else nano_read_table(sus_file),
      source = if (is.null(bam)) "频率表" else "BAM",
      data_note = paste(notes[nzchar(notes)], collapse = "；")
    )
  }
  if (length(samples) == 0) {
    stop(sprintf("%s 底下没有认得出的样本目录（每个样本要有 %s/*.fasta）。", root, NANO_SEQ_DIR))
  }
  samples
}

# 交付包解开之后订单目录在哪。有的包最外层多套一层 `order_XXX/`，有的直接就是样本目录。
nano_package_root <- function(extracted) {
  looks_like_order <- function(d) {
    subs <- list.dirs(d, recursive = FALSE, full.names = TRUE)
    any(vapply(subs, function(s) dir.exists(file.path(s, NANO_SEQ_DIR)), logical(1)))
  }
  if (looks_like_order(extracted)) return(extracted)
  for (d in list.dirs(extracted, recursive = FALSE, full.names = TRUE)) {
    if (looks_like_order(d)) return(d)
  }
  extracted
}

# ── ① 定窗口：整包一次 ───────────────────────────────────────────────────

# 在**任意一个匹配得上的样本**上把 guide 窗口的坐标定下来。
# 返回 list(start = 0-based, length, amplicon_length, anchored_on, anchor_reversed)。
# 一个都匹配不上，说明这批包与这支料对不上——**当场报错，不要猜**。
nano_locate_window <- function(samples, guide) {
  design <- guide$design_sequence
  design_rc <- nano_reverse_complement(design)
  for (sample in samples) {
    if (!nzchar(sample$consensus)) next
    hit <- regexpr(design, sample$consensus, fixed = TRUE)
    if (hit > 0) {
      return(list(start = hit - 1L, length = nchar(design),
                  amplicon_length = nchar(sample$consensus),
                  anchored_on = sample$slot, anchor_reversed = FALSE))
    }
    hit <- regexpr(design_rc, sample$consensus, fixed = TRUE)
    if (hit > 0) {
      return(list(start = hit - 1L, length = nchar(design),
                  amplicon_length = nchar(sample$consensus),
                  anchored_on = sample$slot, anchor_reversed = TRUE))
    }
  }
  stop("这批交付包里没有任何一个样本能匹配上这支料的设计序列——多半是挑错了料，",
       "或者这个包不是这段扩增子的。先人工核对，不要往下算。")
}

# 设计序列上的第 `site` 位（1-based）在扩增子上的 0-based 下标。
# 注意 锚样本本身是反向交付时，窗口内的第 N 位在扩增子坐标上是**从窗口末尾往回数**。
nano_site_index <- function(window, site) {
  if (isTRUE(window$anchor_reversed)) window$start + (window$length - site)
  else window$start + site - 1L
}

# ── ② 定方向：整条序列比 ─────────────────────────────────────────────────

# 这条一致性序列是不是相对参比反向互补交付的。**拿整条比**，不要拿 guide 那 20 位比。
nano_is_reversed <- function(consensus, reference) {
  if (!nzchar(consensus %||% "") || !nzchar(reference %||% "") ||
      nchar(consensus) != nchar(reference)) return(FALSE)
  a <- strsplit(consensus, "", fixed = TRUE)[[1]]
  b <- strsplit(reference, "", fixed = TRUE)[[1]]
  flipped <- strsplit(nano_reverse_complement(consensus), "", fixed = TRUE)[[1]]
  sum(flipped == b) > sum(a == b)
}

# ── ③ 取一行：反向要镜像行号 + 翻碱基身份 ─────────────────────────────────

# 深度为 0 时返回 NA，**不是 0**——读不出和没编辑是两回事。
nano_fraction <- function(numerator, depth) {
  if (is.na(depth) || depth <= 0) NA_real_ else numerator / depth
}

nano_int <- function(value) {
  v <- suppressWarnings(as.integer(value %||% NA))
  if (length(v) != 1 || is.na(v)) 0L else v
}

# 取这个样本在设计序列第 `site` 位上的读值。频率表读不出时返回 NULL。
nano_read_site <- function(sample, window, guide, site, reversed) {
  freq <- sample$frequency
  if (is.null(freq) || nrow(freq) == 0) return(NULL)
  index <- nano_site_index(window, site)
  # 注意 反向交付的样本，它自己那张频率表也是反着排的，行号要镜像。
  if (isTRUE(reversed)) index <- window$amplicon_length - 1L - index
  if (index < 0 || index >= nrow(freq)) return(NULL)
  row <- freq[index + 1L, , drop = FALSE]
  depth <- nano_int(row[["Depth"]])
  # 注意 **行号镜像与碱基翻身，判据不是同一个，别合成一个 `reversed` 用。**
  # `reversed` 是「相对**锚样本**反向」——行号镜像要的就是它，因为坐标系是锚的。
  # 碱基身份要的是「相对**设计序列**反向」＝ `reversed` 与 `anchor_reversed` 的异或：
  # 锚样本自己就是反向互补交付时，与锚同向的样本 `reversed` 为 FALSE，可它相对
  # 设计序列仍是反的，照 `reversed` 取列会整批读到互补碱基——**而且不报错**。
  # 2026-09-21 真包实测：一个零编辑的样本被报成 98.69% 编辑率（读的是未编辑碱基的占比）。
  # 锚是哪个样本又取决于调用方给的行顺序，所以同一批文件换个顺序提交结果会不一样。
  flip_base <- xor(isTRUE(reversed), isTRUE(window$anchor_reversed))
  count <- function(base) {
    column <- if (flip_base) nano_reverse_complement(base) else base
    nano_int(row[[paste0(column, "_num")]])
  }
  counts <- list(A = count("A"), C = count("C"), G = count("G"), T = count("T"),
                 Del = nano_int(row[["Del_num"]]), Ins = nano_int(row[["Ins_num"]]))
  deleted <- nano_fraction(counts$Del, depth)
  inserted <- nano_fraction(counts$Ins, depth)
  list(
    site = site,
    row_number = index + 1L,
    depth = depth,
    counts = counts,
    edited_fraction = nano_fraction(count(guide$edit_to), depth),
    deleted_fraction = deleted,
    inserted_fraction = inserted,
    # 要不要把这一位的 indel 摆出来让人看一眼。**不是判定。**
    indel_surfaced = any(c(deleted, inserted) >= NANO_INDEL_SURFACE_THRESHOLD, na.rm = TRUE)
  )
}

# ── 串起来 ───────────────────────────────────────────────────────────────

# 整包按一支 guide 跑完：每个样本的方向、目标位、旁观位、以及窗口里逐位点的读值。
# 每个结果：list(slot, reversed, target, bystander, window = list(...), suspicious_count,
#              skipped_reason)。`readable` = skipped_reason 为空。
#
# 注意 **一个样本读不出不让整包失败**（真包里就有一个频率表是 0 字节）。
# 读不出的那个**留痕说明为什么**，绝不当成「没编辑」。
nano_analyse <- function(samples, guide) {
  window <- nano_locate_window(samples, guide)
  reference <- NULL
  for (s in samples) if (identical(s$slot, window$anchored_on)) reference <- s$consensus
  sites <- guide$target_site
  if (!is.null(guide$bystander_site) && guide$bystander_site != guide$target_site) {
    sites <- c(sites, guide$bystander_site)
  }
  results <- list()
  for (sample in samples) {
    result <- list(
      slot = sample$slot,
      reversed = nano_is_reversed(sample$consensus, reference),
      target = NULL, bystander = NULL, window = list(),
      suspicious_count = if (is.null(sample$suspicious)) 0L else nrow(sample$suspicious),
      source = sample$source %||% "频率表",
      data_note = sample$data_note %||% "",
      skipped_reason = ""
    )
    # 读不出的原因分三类，别混（2026-10-13）：厂商文件坏了（数据瑕疵，可要求重发）/
    # 目标位真的没覆盖（样本问题）/ 坐标对不上（配置问题）。
    if (is.null(sample$frequency) || nrow(sample$frequency) == 0) {
      # 这句文案进 EditR 推 Hub 的金样（tests/fixtures/golden），改字要两仓同步，先别动。
      result$skipped_reason <- "这个样本的频率表是空文件，读不出任何位点"
      results[[length(results) + 1]] <- result
      next
    }
    if (nchar(sample$consensus) != window$amplicon_length) {
      result$skipped_reason <- sprintf("一致性序列长 %d nt，与这批的 %d nt 对不上，坐标没法共用",
                                       nchar(sample$consensus), window$amplicon_length)
      results[[length(results) + 1]] <- result
      next
    }
    readings <- list()
    for (site in seq_len(window$length)) {
      r <- nano_read_site(sample, window, guide, site, result$reversed)
      if (!is.null(r)) readings[[as.character(site)]] <- r
    }
    result$window <- unname(readings)
    result$target <- readings[[as.character(guide$target_site)]]
    if (!is.null(guide$bystander_site)) {
      result$bystander <- readings[[as.character(guide$bystander_site)]]
    }
    if (is.null(result$target)) {
      result$skipped_reason <- if (nrow(sample$frequency) < window$amplicon_length) {
        sprintf("厂商交付的频率表被截断（只有 %d 行 / 共 %d 行），目标位不在其中，且没有可用的 BAM（数据瑕疵，可要求厂商重发）",
                nrow(sample$frequency), window$amplicon_length)
      } else {
        "目标位那一行读不出深度"
      }
    } else if (result$target$depth <= 0) {
      result$skipped_reason <- "目标位没有读段覆盖（深度 0）"
    }
    results[[length(results) + 1]] <- result
  }
  results
}

nano_readable <- function(result) !nzchar(result$skipped_reason %||% "")

# 窗口里的**可编辑位**：设计序列上碱基等于 edit_from 的那几位（guide 相对 1-based）。
#
# 注意 summary 的 Max / Top 与 heatmap 只看这几位。`edited_fraction` 在别的位上算的是
# 「edit_to 碱基占比」——一个本来就是 T 的位上它恒为 100%，那不是编辑。2026-09-21
# 生产一批 19 管的 Top_Position 全被这种位顶掉；Hub 画热图前有一道「每个位必须是
# 目标碱基」的坐标校验（与 Sanger 那条线同一不变式），全窗口回去它判不出坐标、拒画。
# raw 表照旧回整个窗口：那是逐位点 ACGT 计数，不是编辑率。
nano_editable_sites <- function(guide) {
  bases <- strsplit(guide$design_sequence, "", fixed = TRUE)[[1]]
  which(bases == guide$edit_from)
}

nano_editable_window <- function(result, guide) {
  sites <- nano_editable_sites(guide)
  Filter(function(w) w$site %in% sites, result$window)
}

# ── 整形成 EditR 契约的三张表 ────────────────────────────────────────────
#
# 照 Sanger 那条线的 summary / heatmap / raw 形状出，Hub 那边存表、热图、逐位点表
# 一个字都不用改。比例一律是**百分数**（0–100），读不出是 NA，**不是 0**。

nano_pct <- function(fraction) if (is.null(fraction) || is.na(fraction)) NA_real_ else round(fraction * 100, 2)

# 一位上的**副产物与纯度**。口径与 Sanger 那条线同源，见
# `R/data_processing.R` 的 `calculate_position_quality_metrics()`——那边读的是宽表
# 的 `N<位>_<碱基>` 列，形状不同没法直接复用，所以这里从 `nano_read_site()` 已有的
# counts / depth 重算一遍，**定义一个字不改**。
#
# 为什么要有这三个数（用户 2026-09-21）：CBE 只把 C 脱氨成 U，最终变成 T 要靠修复；
# 修复走别的路时就出 **C→G / C→A**，这是脱氨酶的正常行为，不是异常。
# 只报一个「C→T 编辑率」会让主产物跑到 C→G 的那种批次整个看不出来。
#
# 注意 **与 Sanger 的同名列不可直接横比**：纳米孔每一位的 A+C+G+T+Del+Ins = Depth，
# 所以「总非参比」里**含 indel**，纯度也把 indel 算作不纯（它确实是非预期产物）；
# Sanger 那边没有 indel 这回事。要把 indel 单独拆出来看，用 `Target_Deletion_Rate`
# 与 `Target_Insertion_Rate` 两列。
# 一位上的**四碱基占比**（百分数）。Sanger 那条线的同名四列见
# `R/data_processing.R` 的 `read_position_base_rates()`——那边是从宽表的
# `N<位>_<碱基>` 列直接读，这里形状不同，从 counts / depth 算。
#
# 注意 **与 Sanger 的同名列不可直接横比**：这里的分母是测序深度，而**缺失也占着深度**，
# 所以四项之和 = `100 - 缺失率`，不到 100。Sanger 那边没有 indel，四项之和就是 100。
#
# 注意 **插入不在这个减法里**。频率表的一行是一个「比对列」：一条 read 在这一位要么读到
# 某个碱基、要么是缺失，**A/C/G/T/Del 五者互斥**，加起来正好是深度。而插入发生在
# 两位**之间**，同一条 read 可以既在这一位读到 A、又在这一位后面插了东西——它在
# `A_num` 与 `Ins_num` 里**各记一次**。所以 `Target_Insertion_Rate` 与这四格是
# **重叠**的，不是互补的；把六项全加起来会超过 100。
# 注意 这两条 2026-09-21 在真包频率表上**直接数过**，不是推测：两行 `Depth` 都是 1829，
# `A+C+G+T+Del` 都正好是 1829，再加 `Ins` 变成 1830。见 `docs/nanopore-byproducts.md`。
nano_base_rates <- function(reading) {
  out <- c(A = NA_real_, C = NA_real_, G = NA_real_, T = NA_real_)
  if (is.null(reading) || is.na(reading$depth) || reading$depth <= 0) return(out)
  for (base in c("A", "C", "G", "T")) {
    count <- reading$counts[[base]]
    if (!is.null(count) && !is.na(count)) out[[base]] <- count / reading$depth * 100
  }
  out
}

nano_site_quality <- function(reading, guide) {
  out <- list(total_non_reference = NA_real_, unintended_substitution = NA_real_,
              product_purity = NA_real_)
  if (is.null(reading) || is.na(reading$depth) || reading$depth <= 0) return(out)
  reference <- reading$counts[[guide$edit_from]]
  if (is.null(reference)) return(out)
  out$total_non_reference <- 100 - reference / reading$depth * 100
  # 「非预期替换」＝ 既不是参比、也不是想要的那个产物的另外两个碱基之和。
  others <- setdiff(c("A", "C", "G", "T"), c(guide$edit_from, guide$edit_to))
  counts <- vapply(others, function(base) as.numeric(reading$counts[[base]] %||% NA), numeric(1))
  if (!any(is.na(counts))) out$unintended_substitution <- sum(counts) / reading$depth * 100
  # 纯度＝想要的那个产物占「所有非参比」的比例。分母为 0（这一位一点没动）时留 NA，
  # 不写 0 也不写 100——没有非参比读值时，「纯不纯」这个问题不成立。
  if (!is.na(reading$edited_fraction) && out$total_non_reference > 0) {
    out$product_purity <- reading$edited_fraction * 100 / out$total_non_reference * 100
  }
  out
}

# summary：一个 (样本, 检测) 一行。读不出的样本照样占一行，不静默消失。
nano_summary_df <- function(results, table_names, guide, analysis_guide = guide$design_sequence) {
  rows <- lapply(seq_along(results), function(i) {
    r <- results[[i]]
    t <- r$target
    b <- r$bystander
    window <- nano_editable_window(r, guide)
    window_rates <- vapply(window, function(w) nano_pct(w$edited_fraction), numeric(1))
    top <- if (length(window_rates) && any(!is.na(window_rates))) which.max(window_rates) else NA_integer_
    # 副产物与纯度：**只剩 Top 位一份**（目标位那三列 2026-09-21 已换成四碱基占比）。
    # 旁观位只取编辑率，也照 Sanger（`R/data_processing.R`：Hub 那边旁观位只要两列）。
    pq <- if (is.na(top)) nano_site_quality(NULL, guide) else nano_site_quality(window[[top]], guide)
    tb <- nano_base_rates(t)
    round2 <- function(v) if (is.na(v)) NA_real_ else round(v, 2)
    data.frame(
      Table_Name = table_names[i],
      Target_Base = guide$edit_from,
      Edited_Base = guide$edit_to,
      Target_Position = paste0(guide$edit_from, guide$target_site),
      Target_Position_Edit_Rate = if (is.null(t)) NA_real_ else nano_pct(t$edited_fraction),
      # 目标位上的四碱基占比（2026-09-21 换进来，替掉「总非参比 / 非预期替换 / 产物纯度」
      # 三列，与 Sanger 那条线同一次改动）。分母是深度，四项之和 = 100 - 缺失率。
      Target_A_Rate = round2(tb[["A"]]),
      Target_C_Rate = round2(tb[["C"]]),
      Target_G_Rate = round2(tb[["G"]]),
      Target_T_Rate = round2(tb[["T"]]),
      Bystander_Position = if (is.null(guide$bystander_site)) NA_character_ else paste0(guide$edit_from, guide$bystander_site),
      Bystander_Position_Edit_Rate = if (is.null(b)) NA_real_ else nano_pct(b$edited_fraction),
      Editable_Sites = length(window),
      Max_Edit_Rate = if (is.na(top)) NA_real_ else window_rates[top],
      Top_Position = if (is.na(top)) NA_character_ else paste0(guide$edit_from, window[[top]]$site),
      Top_Position_Edit_Rate = if (is.na(top)) NA_real_ else window_rates[top],
      # Sanger 侧这一列 = 100 - 参比占比（`R/analysis.R:371`），与总非参比同值。
      # 原先写死成 NA，现在按同一定义真正填上。
      Non_Target_Edit_Rate_at_Top_Position = round2(pq$total_non_reference),
      Unintended_Substitution_Rate_at_Top_Position = round2(pq$unintended_substitution),
      Edit_Product_Purity_at_Top_Position = round2(pq$product_purity),
      Analysis_Guide = analysis_guide,
      # 纳米孔独有的几列。Hub 存表时列名取并集，多出来的列直接进。
      Orientation = if (isTRUE(r$reversed)) "反向互补" else "正向",
      Depth = if (is.null(t)) NA_integer_ else t$depth,
      Target_Deletion_Rate = if (is.null(t)) NA_real_ else nano_pct(t$deleted_fraction),
      Target_Insertion_Rate = if (is.null(t)) NA_real_ else nano_pct(t$inserted_fraction),
      Suspicious_Sites = r$suspicious_count,
      Skipped_Reason = r$skipped_reason %||% "",
      stringsAsFactors = FALSE
    )
  })
  if (length(rows) == 0) return(data.frame())
  do.call(rbind, rows)
}

# heatmap：一个 (样本, 窗口里的**可编辑位**) 一行。`Position` 是 guide 相对 1-based。
# 只出目标碱基所在的位（`nano_editable_sites`），与 Sanger 那条线的 heatmap 同一口径。
nano_heatmap_df <- function(results, table_names, guide) {
  rows <- list()
  for (i in seq_along(results)) {
    for (w in nano_editable_window(results[[i]], guide)) {
      rate <- nano_pct(w$edited_fraction)
      if (is.na(rate)) next
      rows[[length(rows) + 1]] <- data.frame(
        Table_Name = table_names[i], Position = w$site,
        Position_Label = paste0(guide$edit_from, w$site), Edit_Rate = rate,
        stringsAsFactors = FALSE)
    }
  }
  if (length(rows) == 0) {
    return(data.frame(Table_Name = character(), Position = integer(),
                      Position_Label = character(), Edit_Rate = numeric(),
                      stringsAsFactors = FALSE))
  }
  do.call(rbind, rows)
}

# raw：逐位点**长表**，一行一位。注意 不转宽表——594 个位点转过去就是上千列。
nano_raw_df <- function(results, table_names) {
  rows <- list()
  for (i in seq_along(results)) {
    for (w in results[[i]]$window) {
      rows[[length(rows) + 1]] <- data.frame(
        Table_Name = table_names[i], Guide_Position = w$site, Table_Row = w$row_number,
        Depth = w$depth, A = w$counts$A, C = w$counts$C, G = w$counts$G, T = w$counts$T,
        Del = w$counts$Del, Ins = w$counts$Ins,
        Edit_Rate = nano_pct(w$edited_fraction),
        # 注意 这一列是**提示**不是判定：5% 只决定要不要摆出来让人看一眼。
        Indel_Flag = if (isTRUE(w$indel_surfaced)) "看一眼" else "",
        stringsAsFactors = FALSE)
    }
  }
  if (length(rows) == 0) return(data.frame())
  do.call(rbind, rows)
}

# ── 按「检测」分组跑整个会话 ───────────────────────────────────────────────
#
# `rows` 是 Hub 派发参数（人核对后）的那份：
#   list(list(file = "<样本目录号>", detections = list(list(target = "GENE_A", guide = "ACGT…",
#        target_position = 6, bystander_position = 8, target_base = "C", edited_base = "T"), …)), …)
# 同一支 guide（序列 + 位点 + 碱基都相同）的样本合成一组定一次窗口；
# 一个样本目录有几条检测就出几行，Table_Name = 目录号（一条）或 `目录号#目标名`（多条）。
nano_detection_key <- function(d) {
  paste(toupper(trimws(d$guide %||% "")), d$target_position %||% "", d$bystander_position %||% "",
        toupper(d$target_base %||% ""), toupper(d$edited_base %||% ""), sep = "|")
}

nano_analyze_rows <- function(root, rows) {
  started <- Sys.time()
  samples <- nano_read_package(root)
  by_slot <- setNames(samples, vapply(samples, function(s) s$slot, character(1)))
  errors <- list()
  summary_parts <- list(); heatmap_parts <- list(); raw_parts <- list()
  name_map <- list()
  # Table_Name → 读值来源与数据瑕疵。不进 summary（那是对外契约的列），由调用方决定怎么摆。
  sources <- list()

  # 归一：每行至少一条检测；没写 detections 的行按顶层字段当一条。
  norm_rows <- list()
  for (r in rows) {
    slot <- as.character(r$file %||% "")
    if (!nzchar(slot)) next
    dets <- r$detections %||% list()
    if (length(dets) == 0) {
      dets <- list(list(target = r$target %||% "", guide = r$guide %||% "",
                        target_position = r$target_position, bystander_position = r$bystander_position,
                        target_base = r$target_base, edited_base = r$edited_base))
    }
    norm_rows[[length(norm_rows) + 1]] <- list(slot = slot, detections = dets)
  }

  # 按检测分组
  groups <- list()
  for (r in norm_rows) {
    multi <- length(r$detections) > 1
    for (d in r$detections) {
      if (is.null(by_slot[[r$slot]])) {
        errors[[length(errors) + 1]] <- list(file = r$slot, error = "交付包里没有这个样本目录",
                                             error_code = "missing_sample", error_label = "缺样本")
        next
      }
      key <- nano_detection_key(d)
      table_name <- if (multi) paste0(r$slot, "#", d$target %||% "") else r$slot
      g <- groups[[key]] %||% list(detection = d, slots = character(0), table_names = character(0))
      g$slots <- c(g$slots, r$slot)
      g$table_names <- c(g$table_names, table_name)
      groups[[key]] <- g
    }
  }

  for (key in names(groups)) {
    g <- groups[[key]]
    d <- g$detection
    guide <- tryCatch(
      nano_guide_spec(d$guide, d$target_position, d$target_base, d$edited_base, d$bystander_position),
      error = function(e) e)
    if (inherits(guide, "error")) {
      for (i in seq_along(g$slots)) {
        errors[[length(errors) + 1]] <- list(file = g$table_names[i], error = conditionMessage(guide),
                                             error_code = "bad_guide", error_label = "位点声明不合法")
      }
      next
    }
    group_samples <- unname(by_slot[g$slots])
    results <- tryCatch(nano_analyse(group_samples, guide), error = function(e) e)
    if (inherits(results, "error")) {
      for (i in seq_along(g$slots)) {
        errors[[length(errors) + 1]] <- list(file = g$table_names[i], error = conditionMessage(results),
                                             error_code = "no_window", error_label = "定不出窗口")
      }
      next
    }
    summary_parts[[length(summary_parts) + 1]] <- nano_summary_df(results, g$table_names, guide)
    heatmap_parts[[length(heatmap_parts) + 1]] <- nano_heatmap_df(results, g$table_names, guide)
    raw_parts[[length(raw_parts) + 1]] <- nano_raw_df(results, g$table_names)
    for (i in seq_along(results)) {
      name_map[[g$table_names[i]]] <- g$slots[i]
      sources[[g$table_names[i]]] <- list(source = results[[i]]$source, data_note = results[[i]]$data_note)
      if (!nano_readable(results[[i]])) {
        errors[[length(errors) + 1]] <- list(file = g$table_names[i], error = results[[i]]$skipped_reason,
                                             error_code = "unreadable", error_label = "读不出")
      }
    }
  }

  bind <- function(parts) {
    parts <- parts[vapply(parts, function(p) !is.null(p) && nrow(p) > 0, logical(1))]
    if (length(parts) == 0) data.frame() else do.call(rbind, parts)
  }
  summary_df <- bind(summary_parts)
  n_rows <- if (nrow(summary_df)) nrow(summary_df) else 0L
  n_success <- if (n_rows) sum(!nzchar(summary_df$Skipped_Reason)) else 0L
  list(
    summary_df = summary_df,
    heatmap_df = bind(heatmap_parts),
    raw_df = bind(raw_parts),
    errors = errors,
    # Table_Name → 样本目录号。Hub 的 file_map 按目录号建，回传时靠它对回去。
    name_map = name_map,
    sources = sources,
    n_files = length(samples),
    n_success = n_success,
    processing_mode = "nanopore",
    elapsed_seconds = round(as.numeric(difftime(Sys.time(), started, units = "secs")), 2)
  )
}
