import { describe, expect, it } from "vitest";
import { canonicalBrand, cleanItemName, cleanSpec, normalizeItemName, stockIdentityKey } from "./stock-normalize";

// 名称和货号均为虚构示例；品牌只用别名表中的公开品牌名。
describe("品牌别名表", () => {
  it("Thermo Fisher=Invitrogen=ABI、诺唯赞=Vazyme、泰坦=Titan/探索平台，忽略大小写空格和组合写法", () => {
    for (const raw of ["Thermo Fisher", "thermofisher", "Invitrogen", "ABI", "Applied Biosystems", "赛默飞"]) expect(canonicalBrand(raw)).toBe("Thermo Fisher");
    for (const raw of ["诺唯赞", "Vazyme", "VAZYME", "诺唯赞/Vazyme", "Vazyme（诺唯赞）"]) expect(canonicalBrand(raw)).toBe("诺唯赞");
    for (const raw of ["泰坦", "Titan", "Titan/泰坦", "探索平台"]) expect(canonicalBrand(raw)).toBe("泰坦");
    expect(canonicalBrand(" 示例品牌 ")).toBe("示例品牌");
    expect(canonicalBrand("")).toBe("");
  });
});

describe("品目同义词与脏写法", () => {
  it("24孔板=24孔细胞培养板=24 well plate，8联/8连/八连管统一", () => {
    const same = ["24孔板", "24孔细胞培养板", "24 孔培养板", "24 well plate", "24-Well Plates"].map(normalizeItemName);
    expect(new Set(same)).toEqual(new Set(["24孔板"]));
    expect(normalizeItemName("96孔半裙边PCR板")).toBe("96孔半裙边pcr板");
    expect(normalizeItemName("透明8联PCR管")).toBe(normalizeItemName("透明8连管"));
    expect(normalizeItemName("高位透明八连排管")).toBe("高位透明8连管");
    expect(normalizeItemName("200ul 枪头")).toBe(normalizeItemName("200ul吸头"));
  });
  it("清理「货号:xxx 名称:xxx」写法，名称取名称字段，规格为空时用货号", () => {
    expect(cleanItemName("货号:EXAMPLE-01 名称:示例试剂盒")).toBe("示例试剂盒");
    expect(cleanItemName("名称：示例试剂盒 货号：EXAMPLE-01")).toBe("示例试剂盒");
    expect(cleanItemName(" 示例  试剂盒 ")).toBe("示例 试剂盒");
    expect(cleanSpec("", "货号:EXAMPLE-01 名称:示例试剂盒")).toBe("EXAMPLE-01");
    expect(cleanSpec("EXAMPLE-02", "货号:EXAMPLE-01 名称:示例试剂盒")).toBe("EXAMPLE-02");
  });
  it("200T / 200 tests / 200Test / 200 T 规格统一为 200T，不误伤 T25、tubes 等写法", () => {
    for (const raw of ["200T", "200 tests", "200Test", "200 T", "200 TESTS"]) expect(cleanSpec(raw)).toBe("200T");
    expect(cleanSpec("EXAMPLE 96 tests/盒")).toBe("EXAMPLE 96T/盒");
    expect(cleanSpec("T25")).toBe("T25");
    expect(cleanSpec("50 tubes")).toBe("50 tubes");
    expect(cleanSpec("T2-PCR0200")).toBe("T2-PCR0200");
  });
  it("归一键：别名、同义词、脏写法和规格写法不同的拆行得到同一个键", () => {
    const keys = [
      { item_name: "24孔细胞培养板", brand: "Invitrogen", spec_model: "EXAMPLE 200 tests" },
      { item_name: "货号:X 名称:24 well plate", brand: "Thermo Fisher", spec_model: "EXAMPLE 200T" },
      { item_name: "24孔板", brand: "ABI", spec_model: "example 200Test" },
    ].map(stockIdentityKey);
    expect(new Set(keys).size).toBe(1);
    expect(stockIdentityKey({ item_name: "24孔板", brand: "示例品牌", spec_model: "A" })).not.toBe(keys[0]);
  });
});
