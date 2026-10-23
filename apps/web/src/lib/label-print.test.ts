import { describe, expect, it } from "vitest";
import { labelRows, parseCopies, parseItemIds, parseSource, parseSourceFields, parseTemplate, SOURCES } from "./label-sources";
import { requireLabelPrinting } from "./label-print";
import type { SessionUser } from "./auth";

const member = (label_print_enabled: boolean): SessionUser => ({
  id: 1, username: "member1", display_name: "示例成员", role: "member", freezer_view_all: false, label_print_enabled,
});

describe("标签来源与字段", () => {
  it("默认来源是部门物料，未知来源被拒绝", () => {
    expect(parseSource(undefined)).toBe("materials");
    expect(parseSource("assets")).toBe("assets");
    expect(() => parseSource("cells")).toThrow("未知的打印来源");
  });

  it("字段白名单按来源校验并保持选择顺序", () => {
    expect(parseSourceFields("materials", ["material_code", "item_name", "unknown"])).toEqual(["material_code", "item_name"]);
    expect(parseSourceFields("assets", ["asset_code", "asset_name"])).toEqual(["asset_code", "asset_name"]);
    expect(() => parseSourceFields("materials", [])).toThrow("至少一个有效打印字段");
    expect(() => parseSourceFields("consumables", ["asset_code"])).toThrow("至少一个有效打印字段");
  });

  it("三个来源各自声明字段，名称都可作为标题", () => {
    for (const source of SOURCES) {
      expect(source.fields.length).toBeGreaterThan(2);
      expect(source.columns.length).toBeGreaterThan(1);
    }
    expect(SOURCES.map((s) => s.key)).toEqual(["materials", "consumables", "assets"]);
  });
});

describe("标签行生成", () => {
  it("第一个字段做标题，其余按「标签：值」逐行，空值跳过", () => {
    const rows = labelRows(
      [{ id: 1, item_name: "琼脂糖", material_code: "M-1", spec_model: "500g", brand: "" }],
      "materials",
      ["item_name", "material_code", "brand", "spec_model"],
    );
    expect(rows).toEqual([{ sample: "琼脂糖", note: "物料编码：M-1；规格型号：500g" }]);
  });

  it("固定资产用资产名称与编号", () => {
    const rows = labelRows([{ id: 2, asset_name: "PCR 仪", asset_code: "CMC-001", location: "3F" }], "assets", ["asset_name", "asset_code", "location"]);
    expect(rows).toEqual([{ sample: "PCR 仪", note: "资产编号：CMC-001；存放地点：3F" }]);
  });

  it("所选字段全为空时报错而不是打印空标签", () => {
    expect(() => labelRows([{ id: 3, item_name: "", material_code: "" }], "materials", ["item_name", "material_code"])).toThrow("没有可打印内容");
  });
});

describe("模板与入参校验", () => {
  it("模板默认名称+字段，未知模板被拒绝", () => {
    expect(parseTemplate(undefined)).toBe("name-detail");
    expect(parseTemplate("uniform")).toBe("uniform");
    expect(() => parseTemplate("fancy")).toThrow("不支持的标签模板");
  });

  it("编号去重并限制批量数量", () => {
    expect(parseItemIds([3, 1, 3])).toEqual([3, 1]);
    expect(() => parseItemIds([])).toThrow("1 至 500");
    expect(() => parseItemIds([0])).toThrow("有效记录");
  });

  it("份数默认 1 并限制在 1 至 20", () => {
    expect(parseCopies(undefined)).toBe(1);
    expect(parseCopies(3)).toBe(3);
    expect(() => parseCopies(0)).toThrow("1 至 20");
    expect(() => parseCopies(21)).toThrow("1 至 20");
  });
});

describe("标签打印按账号开关", () => {
  it("开通的账号放行，未开通的账号被拒且不影响登录", () => {
    expect(requireLabelPrinting(member(true)).username).toBe("member1");
    expect(() => requireLabelPrinting(member(false))).toThrow("未开通标签打印");
  });
});
