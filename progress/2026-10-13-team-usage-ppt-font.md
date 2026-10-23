# 团队使用说明 PPT 字体调整

## What was done

- 按用户要求，将新增第 2、3 页标题、正文、表格及流程编号改为微软雅黑。
- 输出位置：`/Users/wangyichuan/selfapp/cs_temp/工作汇报2026/1013.pptx`。
- 生成入口沿用 `work/ppt-1013/.build/build.mjs`、`merge.py`、`finalize.mjs`。

## Testing

- 两页全部显式字体为「微软雅黑」，与修改前逐项核对文字一致，封面 XML 保持不变。
- 文件非空，ZIP、结构、重新导入检查通过，逐页渲染检查无新增裁切或重叠。
- 本机 PowerPoint 包含微软雅黑字库。未打开 PowerPoint 原生程序验证。

## Notes

- Changed files：指定 PPTX、生成脚本和本记录。
- Rollback：本次修改前备份位于 `work/ppt-1013/.build/before-yahei.pptx`。
