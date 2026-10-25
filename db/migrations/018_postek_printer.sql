-- 018_postek_printer.sql: 接入第二台标签打印机 POSTEK C168/300s（EPL 后端）
INSERT INTO label_printers (printer_key, name, enabled, is_default)
VALUES ('postek-c168', 'POSTEK C168/300s', true, false)
ON CONFLICT (printer_key) DO NOTHING;
