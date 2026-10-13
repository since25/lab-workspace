# windows-wg（Windows 10 LTSC 2019）上 R 的本地编码是 GBK：source() 遇到 GBK 无法表示的字符
#（如注释里的 emoji、数学减号）会静默截断文件，其后定义的函数全部丢失。
# 所有会被 source 的文件必须能无损转成 GBK。用法：在 apps/r-engine 目录下 Rscript tests/test_gbk_safe.R
files <- c("api.R", "start.R", list.files("R", pattern = "\\.R$", full.names = TRUE))
bad <- character(0)
for (f in files) {
  lines <- readLines(f, encoding = "UTF-8", warn = FALSE)
  conv <- iconv(lines, from = "UTF-8", to = "GBK")
  idx <- which(is.na(conv))
  if (length(idx)) bad <- c(bad, sprintf("%s:%d", f, idx))
}
if (length(bad)) stop("以下行含 GBK 无法表示的字符：\n", paste(bad, collapse = "\n"))
cat("test_gbk_safe: ok\n")
