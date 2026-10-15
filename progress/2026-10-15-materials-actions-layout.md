# 物料操作按钮精简与位置调整

## What was done

- 按用户反馈移除“复制采购信息”按钮、复制面板、剪贴板处理及其专用辅助函数和测试；物料信息直接通过页面文字选中复制。
- 将申请已用完、管理员标记/恢复和待批准提示移到物料编码下方，使用 12px 次要文字；名称列只保留名称、源状态和备注，仍保持 10 列。
- 更新现有浏览器交互检查和物料需求说明。沿用同一物料功能上一轮用户明确的提交、推送和部署授权，验证后部署到 windows-wg；生产验收结果待后续追加。

## Testing

- 先更新现有浏览器检查，在修改页面前确认其因复制按钮仍存在而失败；修改后 11 项检查全部通过，包括无复制按钮/面板、申请按钮在编码下方、名称列无按钮、取消确认不提交、待批仍显示、成员无恢复、管理员编码列标记/恢复和批量审批。
- `cd apps/web && npx vitest run`：7 个文件，49/49 通过；较上一轮少 1 项为随已删除复制功能移除的测试。
- `npx tsc --noEmit` 与页面、路由测试、浏览器检查脚本的 ESLint 均通过，`git diff --check` 通过。
- `node apps/web/scripts/check-materials-ui.mjs` 使用实际 React 页面及虚构 API，输出忽略的 `tmp/materials-ui-check/member-list.png` 等截图。已检查文件非空并视觉核对默认物料页布局；不使用真实物料记录作为夹具。

## Notes

- Changed files：`apps/web/src/app/(app)/materials/page.tsx`、删除 `apps/web/src/lib/materials-copy.ts`、`apps/web/src/lib/materials-routes.test.ts`、`apps/web/scripts/check-materials-ui.mjs`、`docs/materials-update-plan.md`、本日志。未涉及数据库结构、增量规则或审批权限改动。
- Rollback：如需恢复此前布局，可恢复本轮页面和复制功能相关文件以及对应说明/测试；部署前保存旧应用包，生产回滚路径和实际部署验证另行追加。未纳入其他未跟踪文件。
- 部署验收追加：用户再次明确要求快速提交、推送和部署。实现提交 `f7659c7` 已推送并部署到 windows-wg，网页构建通过，安装包 VERSION 与服务器一致；ZIP CRC、配置排除扫描和上传 SHA-256 校验通过。HTTP 实际下载的新物料页 JS 与本地构建 SHA-256 完全一致，健康检查数据库和 R 均正常。
- 上线前无排队或运行中的分析任务；部署前后物料全行摘要一致（3,016 条），`lab.env` 与 OA 计划任务定义均未变化。本轮一次性部署任务及临时检查文件已清理，部署日志保留在 `E:\lab-workspace\logs\deploy-materials-ui-20261015.log`。
- Rollback 补充：旧版本 `4a350c3` 的应用包保存于 `C:\lab-workspace\incoming\app.prev-materials-ui-20261015_174416.zip`（7,444,601 字节）。本轮未新增迁移或数据变更，恢复该包并使用现有安装入口即可恢复原页面布局；OA 任务及受限配置保持现状。
