import { describe, expect, it } from "vitest";
import { formatLocation, parseSampleLines } from "./freezer";

describe("formatLocation", () => {
  const base = { freezer_name: "-80 1号", temperature: "-80", shelf_no: 2, rack_no: null, slot_no: null };
  it("盒子：架号、格位齐全", () => {
    expect(formatLocation({ ...base, rack_no: 3, slot_no: 4, kind: "box", name: "交付试剂" })).toBe(
      "-80 1号（-80℃） · 第2层 · 3号架 · 第4格 · 盒子「交付试剂」"
    );
  });
  it("架子格位里的盒子：显示架内层与盒位，不显示旧格位", () => {
    expect(formatLocation({ ...base, rack_no: 1, slot_no: 9, tier_no: 3, depth_no: 2, kind: "box", name: "DIS3" })).toBe(
      "-80 1号（-80℃） · 第2层 · 1号架 · 架内第3层第2盒 · 盒子「DIS3」"
    );
  });
  it("框：不填架号格位", () => {
    expect(formatLocation({ ...base, kind: "basket", name: "大框A" })).toBe("-80 1号（-80℃） · 第2层 · 框「大框A」");
  });
});

describe("parseSampleLines", () => {
  it("Excel 粘贴的多列，空列用统一填写", () => {
    const text = "样品信息\t项目号\t样品类型\t备注\n试剂 A\tP001\t抗体\t\n试剂 B\t\t\t开封过\n\n";
    expect(parseSampleLines(text, { project_no: "P999", sample_type: "试剂" })).toEqual([
      { name: "试剂 A", project_no: "P001", sample_type: "抗体", remarks: "" },
      { name: "试剂 B", project_no: "P999", sample_type: "试剂", remarks: "开封过" },
    ]);
  });
  it("一行一个名称，名称中的逗号不拆分", () => {
    expect(parseSampleLines("IL-2, human\n  质粒 pX330 \n").map((r) => r.name)).toEqual(["IL-2, human", "质粒 pX330"]);
  });
  it("跳过名称为空的行", () => {
    expect(parseSampleLines("\tP001\n试剂 C")).toHaveLength(1);
  });
});
