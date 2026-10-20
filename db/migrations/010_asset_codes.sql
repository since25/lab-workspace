-- 010_asset_codes.sql：固定资产增加资产编号，用于区分同名同规格、存放地点不同的条目
-- 台账里有两套编号：`固定资产编号`（旧，ZX-…）与 `固定资产新编号（2023.7月起）`（新，CMC-…）；
-- 只导入过一套表的行可能只有其中一列，因此两列都保留，展示时优先用新编号。
ALTER TABLE fixed_assets ADD COLUMN asset_code text NOT NULL DEFAULT '';
ALTER TABLE fixed_assets ADD COLUMN asset_code_new text NOT NULL DEFAULT '';
