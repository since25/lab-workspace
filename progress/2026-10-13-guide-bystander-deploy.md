# 2026-10-13 Guide 旁观位部署到 windows-wg

## What was done

- 经用户确认，本地提交 `d8f68d5`（Guide 旁观位）后生成安装包并部署到 windows-wg；升级前备份数据库、保留旧包。详细操作记录在 `../myserver/windows-wg.md`。

## Testing

- 安装 `LastTaskResult=0`；线上 VERSION 为 `d8f68d5`；install.log 显示迁移 006 已执行；健康检查 db 与 r_engine 均正常。
- 未验证：页面上填写旁观位并在纳米孔分析页选 Guide 回填（待用户在页面确认）。
- 本轮尝试用 psql 直查线上表结构，被权限检查拦下（需读取线上数据库口令），改为以安装日志确认迁移。

## Notes

- Changed files：仓库代码无改动；新增本日志。服务器侧更新 `C:\lab-workspace\app\` 与 guides 表结构。
- Rollback：用 `C:\lab-workspace\incoming\app.prev-nanobam.zip` 覆盖 `app.zip` 后重新执行 install.ps1；撤销列见服务器维护记录；数据备份 `E:\lab-workspace\backups\lab_workspace_20261013_1649.dump`。
