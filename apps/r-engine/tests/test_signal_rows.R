source("R/data_processing.R")

editing <- data.frame(
  guide.position = 1:3,
  guide.seq = c("C", "A", "G"),
  A.perc = c(1, 80, 5), C.perc = c(90, 5, 4),
  G.perc = c(2, 10, 88), T.perc = c(7, 5, 3),
  check.names = FALSE, stringsAsFactors = FALSE
)
signals <- build_signal_rows(editing, "sample_1", "CAG")
stopifnot(nrow(signals) == 3)
stopifnot(identical(names(signals), c(
  "Table_Name", "Analysis_Guide", "Guide_Position", "Guide_Base", "A", "C", "G", "T"
)))
stopifnot(signals$Table_Name[1] == "sample_1", signals$Analysis_Guide[1] == "CAG")
stopifnot(signals$Guide_Position[3] == 3L, signals$Guide_Base[1] == "C")
stopifnot(signals$C[1] == 90, signals$T[1] == 7)

empty <- build_signal_rows(NULL, "", "")
stopifnot(nrow(empty) == 0, identical(names(empty), names(signals)))

payload <- list(
  list(Table_Name = "A", Target_Position_Edit_Rate = 12.3, Optional = NULL),
  list(Table_Name = "B", Target_Position_Edit_Rate = 45.6, Optional = "x")
)
pdf <- payload_rows_to_df(payload)
stopifnot(is.data.frame(pdf), nrow(pdf) == 2, pdf$Table_Name[2] == "B")
stopifnot(is.na(pdf$Optional[1]), pdf$Optional[2] == "x")

cat("signal rows test passed\n")
