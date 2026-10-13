# 下载分析服务所需 R 包的 Windows 二进制版本（含全部递归依赖），生成本地仓库供离线安装
# 用法：Rscript infra/windows/build-rpkgs.R <输出目录>
# 目标：Windows 上的 R 4.5 + Bioconductor 3.22
out <- commandArgs(TRUE)[1]
contrib <- file.path(out, "bin", "windows", "contrib", "4.5")
dir.create(contrib, recursive = TRUE, showWarnings = FALSE)
repos <- c(
  CRAN = "https://cloud.r-project.org",
  BioCsoft = "https://bioconductor.org/packages/3.22/bioc",
  BioCann = "https://bioconductor.org/packages/3.22/data/annotation"
)
want <- c("plumber", "jsonlite", "magrittr", "dplyr", "gamlss", "gamlss.dist", "writexl", "zip",
          "digest", "tidyr", "base64enc", "Biostrings", "sangerseqR", "pwalign")
urls <- vapply(repos, function(r) contrib.url(r, type = "win.binary"), "")
urls <- sub("/[0-9.]+$", "/4.5", urls)
ap <- available.packages(contriburl = urls, type = "win.binary")
base <- rownames(installed.packages(priority = "base"))
deps <- unique(c(want, unlist(tools::package_dependencies(want, db = ap, which = c("Depends", "Imports", "LinkingTo"), recursive = TRUE))))
deps <- setdiff(deps, base)
missing <- setdiff(deps, rownames(ap))
if (length(missing)) stop("仓库中找不到：", paste(missing, collapse = ", "))
have <- sub("_.*$", "", list.files(contrib, pattern = "\\.zip$"))
todo <- setdiff(deps, have)
if (length(todo)) download.packages(todo, destdir = contrib, available = ap, type = "win.binary", contriburl = urls)
tools::write_PACKAGES(contrib, type = "win.binary")
cat(sprintf("R 包 %d 个已就绪：%s\n", length(deps), contrib))
