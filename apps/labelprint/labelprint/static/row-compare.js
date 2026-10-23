// 纯逻辑：只处理普通 JS 对象/数组，不摸 DOM（不出现 document/window）。
// 拆出来单独成文件有两个目的：
//   1. 浏览器里通过普通 <script> 标签加载，和 app.js 共享同一个全局作用域，
//      app.js 里的 normalizeRows()/rowsEqual() 直接调用即可，不用改调用方式。
//   2. Node 可以直接 require 这个文件跑纯 JS 单测（tests/frontend/row_compare.test.js），
//      不需要浏览器、不需要 jsdom 之类的 DOM shim——因为这里面压根没有 DOM 依赖。
//      这样"表格快照与预览快照是否一致"这条最要害的判断逻辑就能被
//      tests/test_frontend.py 接进 python3 -m pytest 的一条命令里。

// 从"表格里读出来的原始行"过滤掉样品名为空/纯空白的行。
// 和 app.js 里 handlePreview() 发预览请求前的过滤逻辑必须是同一份实现——
// 否则"当前表格过滤后的样子"和"上次预览时过滤后的样子"用两套不同的过滤
// 标准，比较结果就没有意义。
function normalizeRows(rawRows) {
  return (rawRows || []).filter((r) => r && r.sample && r.sample.trim() !== "");
}

// 比较两组（已经过 normalizeRows 处理的）行是否完全一致，包括顺序。
// 用 JSON.stringify 做深比较：这里的行永远是纯字符串字段的普通对象
// （sample/conc/ratio/note），不含函数、日期、循环引用等 JSON 序列化会失真
// 的内容，序列化后逐字符比较是安全的。
function rowsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Node 侧：暴露成 CommonJS 导出，供纯 JS 单测直接 require。
// 浏览器里 `module` 是 undefined，这个分支不会执行，不影响页面行为。
if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeRows, rowsEqual };
}
