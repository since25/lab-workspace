# 2026-10-13 纳米孔 BAM 主源部署到 windows-wg

## What was done

- 用户反馈线上重提纳米孔分析后「AAT-6 目标位那一行读不出深度」没有变化；核实原因：上一轮 BAM 修复只在开发机完成，线上安装包打包于修复之前，未部署。
- 经用户确认后部署：重新生成安装包，升级前备份数据库、保留旧包，上传并执行 install.ps1（升级路径）。无数据库变更。详细操作记录在 `../myserver/windows-wg.md`。

## Testing

- 部署前：`apps/r-engine/tests` 6 个测试全部通过；`apps/web` `tsc --noEmit` 通过、vitest 24/24 通过。
- 部署后：安装 `LastTaskResult=0`；健康检查 db 与 r_engine 均正常；线上 `nanopore.R` 与开发机 SHA256 一致。
- 未验证：页面上传真实整包重跑，待用户在页面重提那单确认 AAT-6 能出结果。

## Notes

- Changed files：仓库代码无改动；新增本日志。服务器侧更新 `C:\lab-workspace\app\`。
- Rollback：目标机用 `C:\lab-workspace\incoming\app.prev-searchall.zip` 覆盖 `app.zip` 后重新执行 install.ps1；数据备份 `E:\lab-workspace\backups\lab_workspace_20261013_1620.dump`。
