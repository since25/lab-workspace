# 2026-10-13 Sanger 旁观位部署到 windows-wg

## What was done

- 经用户确认，部署本地提交 `e2fcdae`（Sanger 接入旁观位 + 同碱基校验）；升级前备份数据库、保留旧包。详细操作记录在 `../myserver/windows-wg.md`。

## Testing

- 安装 `LastTaskResult=0`；线上 VERSION 为 `e2fcdae`；健康检查 db 与 r_engine 均正常。
- 未验证：页面上 Sanger 填旁观位实跑（待用户在页面确认）。

## Notes

- Changed files：仓库代码无改动；新增本日志。服务器侧更新 `C:\lab-workspace\app\`，无数据库变更。
- Rollback：用 `C:\lab-workspace\incoming\app.prev-guidebys.zip` 覆盖 `app.zip` 后重新执行 install.ps1；数据备份 `E:\lab-workspace\backups\lab_workspace_20261013_1716.dump`。
