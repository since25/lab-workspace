# 启动分析服务：只监听本机，端口由 R_ENGINE_PORT 指定（默认 8001）
# 用法：Rscript start.R（工作目录须为 apps/r-engine）
# Windows 10 LTSC 2019 上 R 的本地编码是 GBK，源码一律按 UTF-8 读取
options(encoding = "UTF-8")
port <- as.integer(Sys.getenv("R_ENGINE_PORT", "8001"))
pr <- plumber::plumb("api.R")
pr$run(host = "127.0.0.1", port = port, docs = FALSE)
