# 团队基础使用说明 PPT

## What was done

- 按请求在指定工作汇报中制作两页使用说明：登录与资源管理、测序分析流程。
- 使用原第 2 页并新增第 3 页，保留原封面及公司版式。使用原生可编辑文本、表格和流程图。
- 内容依据项目 README、部署说明和当前页面实现，未使用真实实验数据或序列。
- 生成入口：`work/ppt-1013/.build/build.mjs`（Artifact Tool 内容页）、`merge.py`（保留源封面与版式合入内容）、`finalize.mjs`（检查并输出）。
- 输入与最终输出：`/Users/wangyichuan/selfapp/cs_temp/工作汇报2026/1013.pptx`。

## Testing

- 最终 PPTX 非空，394511 字节，共 3 页，ZIP 校验正常。
- 结构完整性检查通过，Artifact Tool 可重新导入。
- 两张原生表格与可编辑流程对象检查通过，新增页面无版面检查告警。
- 逐页渲染与人工视觉检查通过；原封面 XML 与源文件逐字节一致。
- 输出 SHA-256：`0157f79c3e3d145fb2b39d3a1f21b407cd68e7ccf2ce4a3c8d3efbb349aceb73`。
- 未在 PowerPoint 原生程序中打开验证。原封面存在两项边界告警，属于既有对象，保持原样。

## Notes

### Changed files

- 指定工作汇报 PPTX，以及本记录与 `work/ppt-1013/` 生成工作文件。
- 未修改应用业务代码，未执行 Git 提交等操作。

### Rollback

- 修改前完整备份：`work/ppt-1013/.build/original.pptx`。需要回滚时将其恢复到指定输出位置。
