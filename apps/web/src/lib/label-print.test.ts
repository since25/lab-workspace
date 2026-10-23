import { describe, expect, it } from "vitest";
import { materialLabelRows, parseCopies, parseMaterialIds, parsePrintFields, parsePrintTemplate, requireLabelPrinting } from "./label-print";
import type { SessionUser } from "./auth";

const item = { id: 1, item_name: "示例耗材", material_code: "EXAMPLE-M-1", brand: "示例品牌", spec_model: "EXAMPLE-SPEC", unit: "盒", department: "示例部门", requester: "示例成员", is_used_up: false };

const member = (label_print_enabled: boolean): SessionUser => ({
  id: 1, username: "member1", display_name: "示例成员", role: "member", freezer_view_all: false, label_print_enabled,
});

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

  it("份数默认 1 并限制在 1 至 20", () => {
    expect(parseCopies(undefined)).toBe(1);
    expect(parseCopies(3)).toBe(3);
    expect(() => parseCopies(0)).toThrow("1 至 20");
    expect(() => parseCopies(21)).toThrow("1 至 20");
  });
});

describe("标签打印可见性按账号开关", () => {
  it("开通的账号放行，未开通的账号被拒且不影响登录", () => {
    expect(requireLabelPrinting(member(true)).username).toBe("member1");
    expect(() => requireLabelPrinting(member(false))).toThrow("未开通标签打印");
  });
});
