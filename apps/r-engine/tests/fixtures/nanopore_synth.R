# 合成的纳米孔交付包（脱敏），给 tests/test_nanopore*.R 共用。
# 形状照真包缩小：既有正向也有反向交付、既有满编辑也有零编辑、分隔符两种都有、还有一个空频率表。
# 真包不进仓库。
LEFT <- "ACGTACGTACGTACGTACGT"          # 20
GUIDE <- "GGTTACCCGTAAGCTTGACA"         # 20，第 6 位是 C（C 在 6/7/8/14/19，共 5 个可编辑位）
RIGHT <- "TTTTGGGGCCCCAAAATTTT"         # 20
AMPLICON <- paste0(LEFT, GUIDE, RIGHT)  # 60
TARGET_SITE <- 6L
TARGET_INDEX0 <- nchar(LEFT) + TARGET_SITE - 1L

COLUMNS <- c("#Clust", "Position", "Consensus", "Depth",
             "A_num", "C_num", "G_num", "T_num", "Del_num", "Ins_num",
             "Top1_base", "Freq_of_top1_base", "Top2_base", "Freq_of_top2_base",
             "Quality", "Homo_num", "Sus_types", "insert_seq")

guide_spec <- function(bystander = NULL) {
  nano_guide_spec(GUIDE, TARGET_SITE, "C", "T", bystander)
}

# 造一个样本目录。`edited_index` 是 0-based、相对 `sequence` 本身。
# `mix`：在 `edited_index` 那一位上直接指定四个碱基各占多少（具名分数向量，如
# c(C = 0.60, T = 0.25, G = 0.10, A = 0.05)）。给了 `mix` 就不走「参比 + 一个产物」
# 那套两碱基写法——副产物（C→G / C→A）与含 indel 的构成只能这么造。
# 给 `mix` 时一致性序列保持参比碱基不变（多数碱基仍是参比）。
write_sample <- function(root, slot, sequence, edited_index = NULL, edited_to = "T",
                         edited_fraction = 0, depth = 1000L, delimiter = "\t",
                         empty_frequency = FALSE, dels = 0L, ins = 0L, suspicious = 0L,
                         mix = NULL) {
  d <- file.path(root, slot)
  for (sub in c("Sequences", "Frequency_tables", "Suspious_sites")) {
    dir.create(file.path(d, sub), recursive = TRUE, showWarnings = FALSE)
  }
  consensus <- strsplit(sequence, "")[[1]]
  if (is.null(mix) && !is.null(edited_index) && edited_fraction > 0.5) consensus[edited_index + 1] <- edited_to
  writeLines(c(sprintf(">Clust_0.1.1|len:%d|num:%d|ratio:0.98|complete:Yes|sus:%d",
                       nchar(sequence), depth, suspicious),
               paste(consensus, collapse = "")),
             file.path(d, "Sequences", paste0(slot, ".consensus.fasta")))
  freq_path <- file.path(d, "Frequency_tables", paste0(slot, ".frequency_table.csv"))
  if (empty_frequency) {
    writeLines(character(0), freq_path)
  } else {
    bases <- strsplit(sequence, "")[[1]]
    lines <- paste(COLUMNS, collapse = delimiter)
    for (i in seq_along(bases)) {
      counts <- c(A = 0L, C = 0L, G = 0L, T = 0L)
      here <- !is.null(edited_index) && (i - 1L) == edited_index
      if (here && !is.null(mix)) {
        for (base in names(mix)) counts[base] <- as.integer(round(depth * mix[[base]]))
      } else if (here) {
        edited_n <- as.integer(round(depth * edited_fraction))
        counts[edited_to] <- edited_n
        counts[bases[i]] <- depth - edited_n
      } else {
        counts[bases[i]] <- depth
      }
      lines <- c(lines, paste(c("Clust_0.1.1", i, bases[i], depth,
                                counts["A"], counts["C"], counts["G"], counts["T"],
                                if (here) dels else 0L, if (here) ins else 0L,
                                bases[i], "1.0", "", "0.0", "Pass", "0", "", ""),
                              collapse = delimiter))
    }
    writeLines(lines, freq_path)
  }
  sus <- paste(COLUMNS, collapse = delimiter)
  for (n in seq_len(suspicious)) sus <- c(sus, paste(c("Clust_0.1.1", n, rep("", 16)), collapse = delimiter))
  writeLines(sus, file.path(d, "Suspious_sites", paste0(slot, ".suspicious_sites.csv")))
}

# 一个合成订单包，形状照真包缩小：既有正向也有反向交付、既有满编辑也有零编辑、
# 分隔符两种都有、还有一个空频率表。
make_package <- function() {
  root <- file.path(tempfile("nano_"), "order_PROJ-001")
  dir.create(root, recursive = TRUE)
  rc <- nano_reverse_complement(AMPLICON)
  rc_target <- nchar(AMPLICON) - 1L - TARGET_INDEX0
  write_sample(root, "9", AMPLICON, edited_index = TARGET_INDEX0, edited_fraction = 0, delimiter = "\t")
  write_sample(root, "27", AMPLICON, edited_index = TARGET_INDEX0, edited_to = "T", edited_fraction = 1, delimiter = ",")
  write_sample(root, "44", rc, edited_index = rc_target, edited_to = nano_reverse_complement("T"),
               edited_fraction = 0.60, delimiter = "\t", suspicious = 1L)
  write_sample(root, "45", rc, edited_index = rc_target, edited_to = nano_reverse_complement("T"),
               edited_fraction = 1, delimiter = ",")
  write_sample(root, "55", AMPLICON, empty_frequency = TRUE)
  root
}

# ── 合成 BAM（2026-10-13，BAM 成为主源后用）─────────────────────────────────
# reads：list(list(pos = 0-based 起点, cigar = "2S10M1I5M", seq = "ACGT…", flag = 0), …)。
# 写成两段 gzip 拼接，模拟 BGZF 的多段结构（只用一段测不出 memDecompress 那个坑）。
cigar_ops <- c(M = 0L, I = 1L, D = 2L, N = 3L, S = 4L, H = 5L, P = 6L, "=" = 7L, X = 8L)
le32 <- function(x) writeBin(as.integer(x), raw(), size = 4L, endian = "little")
le16 <- function(x) writeBin(as.integer(x), raw(), size = 2L, endian = "little")

write_bam <- function(path, ref_len, reads, ref_name = "Clust_0.1.1") {
  text <- charToRaw("@HD\tVN:1.6\n")
  header <- c(charToRaw("BAM"), as.raw(1), le32(length(text)), text, le32(1L),
              le32(nchar(ref_name) + 1L), charToRaw(ref_name), as.raw(0), le32(ref_len))
  records <- lapply(seq_along(reads), function(k) {
    r <- reads[[k]]
    lens <- as.integer(regmatches(r$cigar, gregexpr("[0-9]+", r$cigar))[[1]])
    ops <- cigar_ops[regmatches(r$cigar, gregexpr("[MIDNSHP=X]", r$cigar))[[1]]]
    name <- c(charToRaw(sprintf("r%d", k)), as.raw(0))
    codes <- match(strsplit(r$seq, "")[[1]], strsplit("=ACMGRSVTWYHKDBN", "")[[1]]) - 1L
    if (length(codes) %% 2) codes <- c(codes, 0L)
    packed <- as.raw(codes[c(TRUE, FALSE)] * 16L + codes[c(FALSE, TRUE)])
    body <- c(le32(0L), le32(r$pos), as.raw(length(name)), as.raw(60), le16(0L),
              le16(length(ops)), le16(r$flag %||% 0L), le32(nchar(r$seq)),
              le32(-1L), le32(-1L), le32(0L), name, le32(lens * 16L + ops), packed,
              as.raw(rep(30L, nchar(r$seq))))
    c(le32(length(body)), body)
  })
  bytes <- c(header, unlist(records))
  half <- length(header)
  parts <- list(bytes[seq_len(half)], bytes[-seq_len(half)])
  out <- raw()
  for (p in parts) {
    tmp <- tempfile(fileext = ".gz")
    con <- gzfile(tmp, "wb"); writeBin(p, con); close(con)
    out <- c(out, readBin(tmp, "raw", file.info(tmp)$size))
  }
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  writeBin(out, path)
}

# 给 write_sample 造的样本配一份内容等价的 BAM：depth 条全长读段，
# 前 round(depth * edited_fraction) 条在 edited_index 那一位是 edited_to。
write_sample_bam <- function(root, slot, sequence, edited_index = NULL, edited_to = "T",
                             edited_fraction = 0, depth = 1000L) {
  n_edit <- if (is.null(edited_index)) 0L else as.integer(round(depth * edited_fraction))
  reads <- lapply(seq_len(depth), function(k) {
    s <- sequence
    if (k <= n_edit) substr(s, edited_index + 1L, edited_index + 1L) <- edited_to
    list(pos = 0L, cigar = sprintf("%dM", nchar(s)), seq = s)
  })
  write_bam(file.path(root, slot, "Bam", paste0(slot, ".sort.bam")), nchar(sequence), reads)
}

# 把频率表截成前 n_rows 行数据 + 半行（不以换行结尾），模拟厂商打包截断。
truncate_frequency <- function(root, slot, n_rows) {
  path <- list.files(file.path(root, slot, "Frequency_tables"), full.names = TRUE)[1]
  lines <- readLines(path)
  kept <- paste(lines[seq_len(n_rows + 1L)], collapse = "\n")
  half <- substr(lines[n_rows + 2L], 1L, 15L)
  writeBin(charToRaw(paste0(kept, "\n", half)), path)
}
