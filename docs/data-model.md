# 数据模型草案

## 核心表

### users

`id`, `username`, `display_name`, `password_hash`, `role`, `is_active`, `created_at`, `updated_at`

### guides

`id`, `owner_id -> users.id`, `name`, `target`, `sequence`, `pam`, `strand`, `notes`, `created_at`, `updated_at`

约束：`owner_id + name` 唯一；序列统一大写并校验 IUPAC 字符；普通用户只能访问自己的记录。

### cell_inventory

`id`, `cell_name`, `cell_type`, `source`, `passage`, `concentration`, `volume`, `location`, `freeze_date`, `status`, `remarks`, `import_batch_id`, `created_by`, `created_at`, `updated_at`

### material_items

`id`, `category`, `item_name`, `specification`, `catalog_no`, `unit`, `quantity`, `location`, `status`, `remarks`, `import_batch_id`, `created_at`, `updated_at`

普通用户只读；管理员通过导入批次更新，不提供普通编辑入口。

### import_batches

`id`, `dataset_type`, `filename`, `row_count`, `accepted_count`, `rejected_count`, `created_by`, `created_at`, `status`, `error_summary`

仅保存导入元数据和错误摘要，不保存用户上传的原始工作簿。

### audit_logs

`id`, `actor_id`, `action`, `resource_type`, `resource_id`, `metadata_json`, `ip_hash`, `created_at`

`metadata_json` 禁止写入序列、密码、原始文件内容和敏感样本信息。
