import { describe, expect, it } from "vitest";
import cases from "./__fixtures__/rename-cases.json";
import { RENAME_PRESETS, previewNames } from "./rename";

// 对照数据由 apps/r-engine/tests/make_rename_fixture.R 用分析服务同一套 R 代码生成
describe("previewNames 与 R compute_rename_map 一致", () => {
  for (const c of cases as { preset: string; pattern?: string; replacement?: string; tag: string; names: string[]; expected: string[] }[]) {
    it(`规则 ${c.preset || "无"}${c.tag ? ` + 后缀 ${c.tag}` : ""}`, () => {
      const p = RENAME_PRESETS.find((x) => x.id === c.preset)!;
      const pattern = c.preset === "custom" ? c.pattern! : p.pattern;
      const replacement = c.preset === "custom" ? c.replacement! : p.replacement;
      expect(previewNames(c.names, pattern, replacement, c.tag)).toEqual(c.expected);
    });
  }
});
