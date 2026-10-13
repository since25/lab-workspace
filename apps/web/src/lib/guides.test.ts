import { describe, expect, it } from "vitest";
import { parseGuide } from "./guides";
import { parseGuideSheet } from "./imports/guides";

const base = { name: "G1", sequence: "ACGTACGTAC", target_position: "5" };

describe("parseGuide 旁观位", () => {
  it("选填：不填为 null，填了转成整数", () => {
    expect(parseGuide(base).bystander_position).toBeNull();
    expect(parseGuide({ ...base, bystander_position: "3" }).bystander_position).toBe(3);
  });
  it("超出序列范围或与目标位置相同时报错", () => {
    expect(() => parseGuide({ ...base, bystander_position: "11" })).toThrow("旁观位必须是序列范围内的整数");
    expect(() => parseGuide({ ...base, bystander_position: "1.5" })).toThrow("旁观位必须是序列范围内的整数");
    expect(() => parseGuide({ ...base, bystander_position: "5" })).toThrow("旁观位不能与目标位置相同");
  });
});

describe("parseGuideSheet 旁观位列", () => {
  it("新模板读取旁观位，旧模板没有这一列也能导入", () => {
    const withCol = parseGuideSheet({ name: "s", rows: [["名称", "序列", "目标位置", "旁观位"], ["G1", "ACGTACGTAC", "5", "3"]] });
    expect(withCol.rows[0].bystander_position).toBe(3);
    const old = parseGuideSheet({ name: "s", rows: [["名称", "序列", "目标位置"], ["G1", "ACGTACGTAC", "5"]] });
    expect(old.issues).toEqual([]);
    expect(old.rows[0].bystander_position).toBeNull();
  });
});
