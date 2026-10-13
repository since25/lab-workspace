-- 006_guide_bystander.sql：Guide 增加选填的「旁观位」（guide 内第几位），纳米孔分析选 Guide 时回填
-- 只加一列、允许为空，现有 Guide 不受影响
ALTER TABLE guides ADD COLUMN bystander_position integer;
