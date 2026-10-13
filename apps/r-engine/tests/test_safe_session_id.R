# 会话 id 全部来自外部（body 字段或 X-Session-Id 头）。直接拼进路径会被穿越：
# 今天写坏的只是 tempdir，一旦 upload_dir 改成持久目录（归档树与 SQLite 的同级），
# 一个 "../archive/..." 就能写进归档。
source("R/data_processing.R")   # %||%

# **从 api.R 抽取真正的生产函数**，不在这里另抄一份。
# 抄一份就意味着：改了 api.R 而忘了改这里，测试照样全绿——看门狗永远不叫。
# api.R 是 plumber 入口（顶层有 plumb 注解和副作用），不能整份 source，
# 所以只把这一个函数的定义抽出来求值。
local({
  src <- readLines("api.R")
  s <- grep("^safe_session_id <- function", src)
  stopifnot(length(s) == 1)
  s <- s[[1]]
  e <- s + which(trimws(src[s:length(src)]) == "}")[1] - 1
  eval(parse(text = paste(src[s:e], collapse = "\n")), envir = globalenv())
})
stopifnot(is.function(safe_session_id))

# 合法值原样通过——真实会话 id 就是「时间戳_随机数」
stopifnot(identical(safe_session_id("20260807131143_8011"), "20260807131143_8011"))
stopifnot(identical(safe_session_id("verify_1786079834"), "verify_1786079834"))

# 路径穿越一律**拒绝**，而不是 basename 挽救成另一个值——
# basename("../../etc") = "etc"，那会让调用方以为自己拿到了请求的会话。
stopifnot(identical(safe_session_id("../../etc"), ""))
stopifnot(identical(safe_session_id("../archive/PROJ-001"), ""))
stopifnot(identical(safe_session_id("/etc/passwd"), ""))
stopifnot(identical(safe_session_id("a/../../b"), ""))

# 空与异常输入
stopifnot(identical(safe_session_id(""), ""))
stopifnot(identical(safe_session_id(NULL), ""))
stopifnot(identical(safe_session_id("   "), ""))

# 含空格或特殊字符的一律拒绝（真实会话 id 不会长这样）
stopifnot(identical(safe_session_id("a b"), ""))
stopifnot(identical(safe_session_id("a;rm -rf"), ""))
# 纯 .. 段也要挡（字符集本身允许点号，靠单独一条规则兜住）
stopifnot(identical(safe_session_id(".."), ""))
stopifnot(identical(safe_session_id("a..b"), ""))

cat("safe_session_id test passed\n")

# 纯符号的 id 一律拒绝。单个 "." 满足字符集且不含 ".."，但
# file.path(upload_dir, ".") 就是 upload_dir 本身——所有会话的文件都在那儿。
for (bad in c(".", "-", "_", "...", ".-_")) {
  stopifnot(identical(safe_session_id(bad), ""))
}
