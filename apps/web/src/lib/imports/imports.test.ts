import { describe, expect, it } from "vitest";
import { parseCellWorkbook, parseLayer } from "./cells";
import { parseMaterialWorkbook } from "./materials";
import { parseCsv, parseLooseDate } from "./sheet";

// 全部为虚构数据，结构与真实登记表一致
describe("parseLooseDate", () => {
  it("识别常见写法", () => {
    expect(parseLooseDate(44624)).toBe("2022-03-04");
    expect(parseLooseDate(20250307)).toBe("2025-03-07");
    expect(parseLooseDate("2025.3.7")).toBe("2025-03-07");
    expect(parseLooseDate(new Date(Date.UTC(2025, 11, 12)))).toBe("2025-12-12");
  });
  it("拒绝不可靠的值", () => {
    expect(parseLooseDate(202411)).toBeNull();
    expect(parseLooseDate("4.29.24")).toBeNull();
    expect(parseLooseDate(20251399)).toBeNull();
  });
});

describe("parseCellWorkbook", () => {
  const sheet = {
    name: "2号架",
    rows: [
      ["示例冻存登记表", null, null, null, null, null, null, null, null],
      ["层数", "细胞名称", "来源", "代次", "细胞密度", "冻存液", "管数", "存放人", "放入时间"],
      ["一", "CELL-A", "来源A", "P1", "2M", "cell banker", 12, "甲", 44624],
      [null, "CELL-B", null, null, null, null, "3/2/4管", "乙", 202411],
      ["二", null, null, null, null, null, null, null, null],
      [null, null, "来源C", null, null, null, 5, null, null],
      ["三", "CELL-C\nCELL-D", null, null, null, null, 4, "丙", "20250307"],
      ["Note：一架共10层，每层81孔。", null, null, null, null, null, null, null, null],
    ],
  };
  const { rows, issues } = parseCellWorkbook([sheet]);

  it("按表名取架号、层数向下填充", () => {
    expect(rows.map((r) => [r.rack_no, r.layer_no, r.cell_name])).toEqual([
      [2, 1, "CELL-A"],
      [2, 1, "CELL-B"],
      [2, 3, "CELL-C\nCELL-D"],
    ]);
  });
  it("正常值直接转换", () => {
    expect(rows[0]).toMatchObject({ tube_count: 12, frozen_on: "2022-03-04", needs_review: false });
  });
  it("无法识别的值保留原文并标待核对", () => {
    expect(rows[1]).toMatchObject({ tube_count: null, tube_count_raw: "3/2/4管", frozen_on: null, frozen_on_raw: "202411", needs_review: true });
    expect(rows[2].needs_review).toBe(true);
    expect(rows[2].frozen_on).toBe("2025-03-07");
  });
  it("名称为空但有内容的行进入问题列表", () => {
    expect(issues).toEqual([{ sheet: "2号架", row: 6, message: "细胞名称为空但其他列有内容，未导入" }]);
  });
  it("层数中文数字", () => {
    expect(parseLayer("十")).toBe(10);
    expect(parseLayer("11")).toBeNull();
  });
});

describe("parseMaterialWorkbook", () => {
  const header = ["请购日期", "请购人", "任职部门", "采购单编码", "物料编码", "状态", "请购大类", "请购小类", "名称", "品牌", "规格型号", "单位", "数量", "是否紧急", "使用项目", "备注", "合同或订单编号", "采购数量", "最近收货日期", "收货数量", "收货状态"];
  const row = (code: string) => ["2026-01-05", "甲", "示例部门", "REQ-1", code, "启用", "采购类采购", "耗材", " 离心管 ", "品牌A", "15 mL", "包", 2, "勾选", " PRJ-1", "", "ORD-1", 2, "2026-01-12", 2, "全部收货"];
  it("跳过标题行、去空格、去重", () => {
    const { rows, issues, fatal } = parseMaterialWorkbook([
      { name: "部门物料", rows: [["部门物料"], ["数据源：示例"], header, row("M-1"), row("M-1"), row("")] },
    ]);
    expect(fatal).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ material_code: "M-1", item_name: "离心管", project_code: "PRJ-1", is_urgent: true, quantity: 2, requested_on: "2026-01-05" });
    expect(issues.map((i) => i.row)).toEqual([5, 6]);
  });
  it("不是采购导出时整份拒绝", () => {
    expect(parseMaterialWorkbook([{ name: "x", rows: [["a", "b"]] }]).fatal).toContain("物料编码");
  });
});

describe("parseCsv", () => {
  it("处理引号、逗号和换行", () => {
    expect(parseCsv('a,"b,1","c ""x""\nd"\r\n,2\n')).toEqual([["a", "b,1", 'c "x"\nd'], [null, "2"]]);
  });
});
