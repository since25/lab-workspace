# V1 API 草案

所有接口前缀为 `/api/v1`，除登录接口外需要有效会话。

## 认证

- `POST /auth/login`：用户名/密码登录
- `POST /auth/logout`：注销
- `GET /auth/me`：当前用户

## Guide

- `GET /guides`
- `POST /guides`
- `PATCH /guides/:id`
- `DELETE /guides/:id`
- `GET /guides/export?format=csv`

## 分析任务

- `POST /analysis/sanger`：上传单序列与参数，返回临时任务 ID
- `POST /analysis/nanopore`：上传数据与参数，返回临时任务 ID
- `GET /analysis/jobs/:id`：查询状态和可下载结果
- `GET /analysis/jobs/:id/download?format=xlsx|csv|zip`
- `DELETE /analysis/jobs/:id`：立即清理临时任务

任务响应不返回历史归档链接；任务过期后返回 `410 Gone`。

## 资源库

- `GET /cells`
- `POST /cells`
- `POST /cells/import`
- `GET /materials`
- `POST /materials/import`（仅 admin）
- `GET /imports/:id/errors`

## 管理

- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users/:id/status`
- `GET /admin/audit-logs`
