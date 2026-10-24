import { describe, expect, it } from "vitest";
import { expandByTubeCount, labelRows, parseCopies, parseItemIds, parseSource, parseSourceFields, parseTemplate, SOURCES } from "./label-sources";
import { requireLabelPrinting } from "./label-print";
import type { SessionUser } from "./auth";

const member = (label_print_enabled: boolean): SessionUser => ({
  id: 1, username: "member1", display_name: "示例成员", role: "member", freezer_view_all: false, label_print_enabled,
});

describe("标签来源与字段", () => {
  it("默认来源是部门物料，未知来源被拒绝", () => {
    expect(parseSource(undefined)).toBe("materials");
    expect(parseSource("assets")).toBe("assets");
    expect(parseSource("freezer")).toBe("freezer");
    expect(parseSource("cells")).toBe("cells");
    expect(parseSource("custom")).toBe("custom");
    expect(() => parseSource("consumables")).toThrow("未知的打印来源");
  });

  it("字段白名单按来源校验并保持选择顺序", () => {
    expect(parseSourceFields("materials", ["material_code", "item_name", "unknown"])).toEqual(["material_code", "item_name"]);
    expect(parseSourceFields("assets", ["asset_code", "asset_name"])).toEqual(["asset_code", "asset_name"]);
    expect(parseSourceFields("cells", ["cell_name", "passage", "location"])).toEqual(["cell_name", "passage", "location"]);
    expect(parseSourceFields("custom", ["样本名", "浓度", "日期"])).toEqual(["样本名", "浓度", "日期"]);
    expect(() => parseSourceFields("materials", [])).toThrow("至少一个有效打印字段");
    expect(() => parseSourceFields("freezer", ["asset_code"])).toThrow("至少一个有效打印字段");
    expect(() => parseSourceFields("cells", ["unknown_field"])).toThrow("至少一个有效打印字段");
    expect(() => parseSourceFields("custom", [])).toThrow("至少一个有效打印字段");
  });

  it("五个来源各自声明字段，名称都可作为标题", () => {
    for (const source of SOURCES) {
      expect(source.fields.length).toBeGreaterThan(1);
      expect(source.columns.length).toBeGreaterThan(0);
    }
    expect(SOURCES.map((s) => s.key)).toEqual(["materials", "freezer", "assets", "cells", "custom"]);
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

  it("自定义 CSV 数据行生成", () => {
    const rows = labelRows(
      [{ id: 10, 试剂名称: "Anti-Flag mAb", 浓度: "1 mg/mL", 体积: "200 μL", 日期: "2026-10-24" }],
      "custom",
      ["试剂名称", "浓度", "体积", "日期"],
    );
    expect(rows).toEqual([{ sample: "Anti-Flag mAb", note: "浓度：1 mg/mL；体积：200 μL；日期：2026-10-24" }]);
  });

  it("冰箱样品用样品信息与项目号", () => {
    const rows = labelRows(
      [{ id: 9, name: "HeLa P3", project_no: "P2026-01", sample_type: "细胞", location: "-80 1号（-80℃） · 第1层 · 盒子「A」", stored_on: "2026-10-01" }],
      "freezer",
      ["name", "project_no", "sample_type"],
    );
    expect(rows).toEqual([{ sample: "HeLa P3", note: "项目号：P2026-01；样品类型：细胞" }]);
  });

  it("固定资产用资产名称与编号", () => {
    const rows = labelRows([{ id: 2, asset_name: "PCR 仪", asset_code: "CMC-001", location: "3F" }], "assets", ["asset_name", "asset_code", "location"]);
    expect(rows).toEqual([{ sample: "PCR 仪", note: "资产编号：CMC-001；存放地点：3F" }]);
  });

  it("细胞冻存用细胞名称、代次、位置与冻存人", () => {
    const rows = labelRows(
      [{ id: 5, cell_name: "HEK293T", passage: "P12", location: "1号架 / 2层", depositor: "王小明", frozen_on: "2026-10-24" }],
      "cells",
      ["cell_name", "passage", "location", "depositor", "frozen_on"],
    );
    expect(rows).toEqual([{ sample: "HEK293T", note: "代次：P12；位置：1号架 / 2层；冻存人：王小明；冻存日期：2026-10-24" }]);
  });

  it("按管数展开支持多份打印与异常管数兜底", () => {
    const items = [
      { id: 1, cell_name: "293T", tube_count: 3 },
      { id: 2, cell_name: "HeLa", tube_count: 1 },
      { id: 3, cell_name: "Jurkat", tube_count: 0 },
      { id: 4, cell_name: "Raji", tube_count: "invalid" as unknown as number },
    ];
    const expanded = expandByTubeCount(items as unknown as Parameters<typeof expandByTubeCount>[0]);
    // 3 + 1 + 1 (兜底) + 1 (兜底) = 6
    expect(expanded.length).toBe(6);
    expect(expanded.filter((x) => x.id === 1).length).toBe(3);
    expect(expanded.filter((x) => x.id === 2).length).toBe(1);
    expect(expanded.filter((x) => x.id === 3).length).toBe(1);
    expect(expanded.filter((x) => x.id === 4).length).toBe(1);
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
