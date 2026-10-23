// 纯逻辑单测：只 require labelprint/static/row-compare.js，不摸 DOM，
// 用 Node 内置的 node:test / node:assert 跑，不需要装任何 npm 包。
// 通过 tests/test_frontend.py 里的 subprocess 调用接进 pytest 的一条命令。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRows, rowsEqual } = require("../../labelprint/static/row-compare.js");

test("normalizeRows 丢弃样品名为空/纯空白的行，保留其余字段与顺序", () => {
  const input = [
    { sample: "S1", conc: "10", ratio: "", note: "" },
    { sample: "", conc: "1", ratio: "", note: "备注" },
    { sample: "   ", conc: "", ratio: "", note: "" },
    { sample: "S2", conc: "", ratio: "1.8", note: "" },
  ];
  assert.deepStrictEqual(normalizeRows(input), [
    { sample: "S1", conc: "10", ratio: "", note: "" },
    { sample: "S2", conc: "", ratio: "1.8", note: "" },
  ]);
});

test("normalizeRows 对 null/undefined/空数组输入返回空数组，不抛异常", () => {
  assert.deepStrictEqual(normalizeRows(null), []);
  assert.deepStrictEqual(normalizeRows(undefined), []);
  assert.deepStrictEqual(normalizeRows([]), []);
});

test("rowsEqual 内容与顺序都相同才算相等", () => {
  const a = [{ sample: "S1", conc: "1", ratio: "", note: "" }];
  const b = [{ sample: "S1", conc: "1", ratio: "", note: "" }];
  assert.strictEqual(rowsEqual(a, b), true);
});

test("rowsEqual 检测出内容不同——对应审查发现的绕过路径：表格 .value 被程序化" +
     "改成了别的内容、没有触发 input 事件，previewRows 还停留在旧值，" +
     "打印前重新读表格算出的 currentRows 必须能被判定为跟旧快照不相等", () => {
  const previewRows = [{ sample: "Sample1", conc: "", ratio: "", note: "" }];
  const currentRows = [{ sample: "Sample2", conc: "", ratio: "", note: "" }];
  assert.strictEqual(rowsEqual(currentRows, previewRows), false);
});

test("rowsEqual 检测出行数不同（加了一行）", () => {
  const a = [{ sample: "S1", conc: "", ratio: "", note: "" }];
  const b = [
    { sample: "S1", conc: "", ratio: "", note: "" },
    { sample: "S2", conc: "", ratio: "", note: "" },
  ];
  assert.strictEqual(rowsEqual(a, b), false);
});

test("rowsEqual 检测出顺序不同", () => {
  const a = [
    { sample: "S1", conc: "", ratio: "", note: "" },
    { sample: "S2", conc: "", ratio: "", note: "" },
  ];
  const b = [
    { sample: "S2", conc: "", ratio: "", note: "" },
    { sample: "S1", conc: "", ratio: "", note: "" },
  ];
  assert.strictEqual(rowsEqual(a, b), false);
});
