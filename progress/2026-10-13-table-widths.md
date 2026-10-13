# 2026-10-13 部门物料 / 固定资产表格列宽与换行

## What was done

- 新增表格列样式：短字段（日期、数量、小类、项目、请购人、收货、物料编码、类别、存放地点、使用部门、使用人）不换行；名称列限宽 220–360px 按词换行；品牌列限宽 160px；规格型号只在放不下时断开（取消原来的任意字符断行）。
- 应用到部门物料与固定资产两张表；已部署到 windows-wg。

## Testing

- lint、构建通过；本机导入真实物料数据后用浏览器在 1280 / 1600 宽度截图核对：短字段列无换行、无横向滚动条，名称与长品牌正常折行。
- 生产：安装结果 0，健康检查正常，线上样式表含新规则。

## Notes

- Changed files：`apps/web/src/app/globals.css`、`apps/web/src/app/(app)/materials/page.tsx`、`apps/web/src/app/(app)/assets/page.tsx`。
- Rollback：恢复上述文件后重新打包部署。未做 Git 提交。
