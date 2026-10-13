-- 003_analysis_units.sql：记录每个分析任务的文件/样本数，用于排队时估算耗时
ALTER TABLE analysis_jobs ADD COLUMN n_units integer NOT NULL DEFAULT 0;
