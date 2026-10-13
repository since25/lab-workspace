# 2026-10-13 反馈改进两轮部署到 windows-wg

## What was done

- 经用户确认，部署本地提交 `ff1d005`（细胞冻存导出/下拉/低库存提醒、物料下拉、冰箱按台分与 -80℃ 布局图、留言板）。升级前备份数据库、保留旧包。详细操作记录在 `../myserver/windows-wg.md`。

## Testing

- 安装 `LastTaskResult=0`；线上 VERSION 为 `ff1d005`；install.log 显示执行了迁移 007、008；健康检查 db 与 r_engine 均正常；新接口（留言未读、架子、细胞导出）未登录返回 401。
- 未验证：线上页面实际点击（本机已做端到端与页面点击测试，见 `2026-10-13-feedback-round.md`）。

## Notes

- Changed files：仓库代码无改动；新增本日志。服务器侧更新 `C:\lab-workspace\app\`，数据库新增迁移 007、008。
- 上线后待管理员操作：给 -80℃ 冰箱填布局（4 层 × 每层 4 架位）、放架子并分配、在第 4 层建 2 个公共框。
- Rollback：用 `C:\lab-workspace\incoming\app.prev-sangerbys.zip` 覆盖 `app.zip` 后重新执行 install.ps1；数据备份 `E:\lab-workspace\backups\lab_workspace_20261014_0730.dump`。
