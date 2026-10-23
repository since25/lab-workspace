import { describe, expect, it } from "vitest";
import { materialLabelRows, parseMaterialIds, parsePrintFields, parsePrintTemplate } from "./label-print";

const item = { id: 1, item_name: "示例耗材", material_code: "EXAMPLE-M-1", brand: "示例品牌", spec_model: "EXAMPLE-SPEC", unit: "盒", department: "示例部门", requester: "示例成员", is_used_up: false };

describe("标签打印字段与模板", () => {
  it("限制字段白名单并按选择顺序生成标签行", () => {
    const fields = parsePrintFields(["material_code", "spec_model", "material_code"]);
    expect(fields).toEqual(["material_code", "spec_model"]);
    expect(materialLabelRows([item], fields)).toEqual([{ sample: "EXAMPLE-M-1", note: "规格型号：EXAMPLE-SPEC" }]);
  });

  it("没有可打印字段和未知模板时拒绝请求", () => {
    expect(() => parsePrintFields([])).toThrow("有效打印字段");
    expect(() => parsePrintTemplate("other-template")).toThrow("不支持");
  });

  it("限制批量物料编号数量并去重", () => {
    expect(parseMaterialIds([1, 2, 1])).toEqual([1, 2]);
    expect(() => parseMaterialIds([])).toThrow("1 至 500");
    expect(() => parseMaterialIds([0])).toThrow("有效物料");
  });
});
