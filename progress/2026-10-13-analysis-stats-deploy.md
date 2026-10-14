# 2026-10-13 分析看板部署到 windows-wg

## What was done

- 经用户要求「提交，部署」：本地提交 `9ae6f64`（首页分析看板 + 分析完成祝贺），打包后安装到 windows-wg；升级前备份数据库、保留旧包。详细操作记录在 `../myserver/windows-wg.md`。

## Testing

- 安装 `LastTaskResult=0`；线上 VERSION `9ae6f64`；app.zip SHA256 两端一致；健康检查 db 与 r_engine 均正常；无数据库迁移。
- 未验证：线上页面看板数字与实跑一次分析后的祝贺提示（待用户在页面确认）。

## Notes

- Changed files：仓库代码无改动；新增本日志。服务器侧更新 `C:\lab-workspace\app\`。
- Rollback：用 `C:\lab-workspace\incoming\app.prev-feedback.zip` 覆盖 `app.zip` 后重新执行 install.ps1；数据备份 `E:\lab-workspace\backups\lab_workspace_20261014_1342.dump`。
