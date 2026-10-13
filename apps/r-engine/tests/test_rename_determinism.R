source("R/data_processing.R")
fn <- c("s10.ab1","s2.ab1","s1.ab1")
m1 <- compute_rename_map(fn)
m2 <- compute_rename_map(rev(fn))
# 顺序无关：同文件同 Table_Name
stopifnot(identical(unname(m1["s1.ab1"]), unname(m2["s1.ab1"])))
stopifnot(identical(unname(m1["s10.ab1"]), unname(m2["s10.ab1"])))
# 规则归并到同名 → make.unique 确定（与顺序无关）
rc <- list(pattern = "_.*", replacement = "")  # 全归并成相同前缀
a <- compute_rename_map(c("x_1.ab1","x_2.ab1","x_3.ab1"), rc)
b <- compute_rename_map(c("x_3.ab1","x_1.ab1","x_2.ab1"), rc)
stopifnot(identical(unname(a["x_1.ab1"]), unname(b["x_1.ab1"])))
# 预览委托 == 分析
pv <- compute_renamed_files(fn, NULL, NULL, NULL)
stopifnot(identical(pv$Preview_Name, unname(m1[pv$Original_Name])))

# 默认规则：保留文件名按点分隔后的前两段，并保留 .ab1 下载后缀
default_presets <- list(
  combined_default = list(
    pattern = "^([^.]+\\.[^.]+)\\..*$",
    replacement = "\\1"
  )
)
default_files <- "R1-9.IDUAR.3380632.G05100E04.H03.ab1"
default_map <- compute_rename_map(
  default_files,
  list(preset = "combined_default"),
  default_presets
)
stopifnot(identical(unname(default_map[[1]]), "R1-9.IDUAR"))
default_preview <- compute_renamed_files(
  default_files,
  default_presets$combined_default$pattern,
  default_presets$combined_default$replacement,
  NULL
)
stopifnot(identical(default_preview$Download_File[[1]], "R1-9.IDUAR.ab1"))

cat("rename determinism test passed\n")
