import { describe, expect, it } from "vitest";
import { bystanderBaseError, parseGuide } from "./guides";
import { parseGuideSheet } from "./imports/guides";

const base = { name: "G1", sequence: "ACGTACGTAC", target_position: "5" };

describe("parseGuide 旁观位", () => {
  it("选填：不填为 null，填了转成整数", () => {
    expect(parseGuide(base).bystander_position).toBeNull();
    expect(parseGuide({ ...base, bystander_position: "1" }).bystander_position).toBe(1);
  });
  it("超出序列范围或与目标位置相同时报错", () => {
    expect(() => parseGuide({ ...base, bystander_position: "11" })).toThrow("旁观位必须是序列范围内的整数");
    expect(() => parseGuide({ ...base, bystander_position: "1.5" })).toThrow("旁观位必须是序列范围内的整数");
    expect(() => parseGuide({ ...base, bystander_position: "5" })).toThrow("旁观位不能与目标位置相同");
  });
});

describe("旁观位同碱基校验", () => {
  // 序列 ACGTACGTAC：第 1、5、9 位是 A，第 3 位是 G
  it("与目标碱基不同时报错，相同时通过", () => {
    expect(() => parseGuide({ ...base, target_base: "A", bystander_position: "3" })).toThrow("与目标碱基 A 不同");
    expect(parseGuide({ ...base, target_base: "A", bystander_position: "9" }).bystander_position).toBe(9);
  });
  it("没填目标碱基时以目标位置上的碱基为准", () => {
    expect(() => parseGuide({ ...base, bystander_position: "3" })).toThrow("与目标碱基 A 不同");
  });
  it("目标碱基与目标位置都没填时不拦", () => {
    expect(parseGuide({ name: "G2", sequence: "ACGTACGTAC", bystander_position: "3" }).bystander_position).toBe(3);
  });
  it("bystanderBaseError 直接比较", () => {
    expect(bystanderBaseError("ACGT", 1, "A")).toBeNull();
    expect(bystanderBaseError("ACGT", 2, "A")).toContain("第 2 位是 C");
    expect(bystanderBaseError("ACGT", 2, "")).toBeNull();
  });
});

describe("parseGuideSheet 旁观位列", () => {
  it("新模板读取旁观位，旧模板没有这一列也能导入", () => {
    const withCol = parseGuideSheet({ name: "s", rows: [["名称", "序列", "目标位置", "旁观位"], ["G1", "ACGTACGTAC", "5", "1"]] });
    expect(withCol.rows[0].bystander_position).toBe(1);
    const old = parseGuideSheet({ name: "s", rows: [["名称", "序列", "目标位置"], ["G1", "ACGTACGTAC", "5"]] });
    expect(old.issues).toEqual([]);
    expect(old.rows[0].bystander_position).toBeNull();
  });
});
