import { describe, expect, it } from "vitest";
import { matchSlot, SLOT_TEMPLATES, slotTemplate } from "./consumable-slots";

// 写法取自台账常见格式，品牌和货号为虚构或公开产品名。
const m = (item_name: string, spec_model = "", minor_category = "", brand = "") => matchSlot({ item_name, brand, spec_model, minor_category });

describe("槽位模板", () => {
  it("模板 key 唯一，类别都是「大类/子类」", () => {
    expect(new Set(SLOT_TEMPLATES.map((t) => t.key)).size).toBe(SLOT_TEMPLATES.length);
    expect(SLOT_TEMPLATES.every((t) => /^[^/]+\/[^/]+$/.test(t.category) && t.unit)).toBe(true);
    expect(slotTemplate("tip-200f")).toMatchObject({ name: "200µL 滤芯吸头", unit: "箱" });
  });
});

describe("采购写法 → 槽位", () => {
  it("塑料耗材按容量、滤芯归位", () => {
    const cases: [string, string, string][] = [
      ["10μl 叠装短吸头", "T-10DS", "tip-10"], ["2-20μL，超疏水吸头", "", "tip-10"],
      ["10μl 透明滤芯吸头，盒装，无菌", "", "tip-10f"], ["200μl 叠装短吸头", "T-200DS", "tip-200"],
      ["200ul吸头滤芯低吸附盒装灭菌", "TF-200-L-R-S", "tip-200f"], ["1250ul叠装吸头", "", "tip-1000"],
      ["QSP 1000，带滤芯", "", "tip-1000f"], ["QSP 1000，无滤芯型", "", "tip-1000"],
      ["1.5ml 无色灭菌离心管", "", "tube-1.5"], ["2ml离心管", "YB-2S", "tube-2"], ["离心管 15ml 圆锥底 消毒", "", "tube-15"],
      ["50mL离心管 无架包装", "", "tube-50"], ["10ml 移液管", "YB-10", "pipet-10"], ["[CCP]25ml血清移液管", "", "pipet-25"],
      ["透明8联PCR管 平盖", "", "pcr-strip"], ["耐思 PCR 8联管盖", "", "pcr-cap"], ["200μl 96孔半裙边PCR板，透明", "", "pcr-plate"],
      ["封膜，普通型，适用于96孔板、深孔板", "", "seal"],
    ];
    for (const [name, spec, key] of cases) expect([name, m(name, spec)?.key]).toEqual([name, key]);
  });
  it("细胞耗材：只收 TC 板、60/100mm 皿；非 TC 板、U 底、150mm、多层瓶不归位，未 TC 培养瓶给中等把握", () => {
    expect(m("24孔细胞培养板，平底，TC")).toEqual({ key: "plate-24", confidence: "high" });
    expect(m("6-well plate", "TC")?.key).toBe("plate-6");
    expect(m("Nunc EasYDish 培养皿", "150466")?.key).toBe("dish-100");
    expect(m("培养皿（无菌）", "PYM-60")?.key).toBe("dish-60");
    expect(m("Corning 外旋冻存管")?.key).toBe("cryovial-2");
    expect(m("一次性细胞过滤器 70um 橘色")?.key).toBe("strainer-70");
    expect(m("耐思 细胞培养瓶-T25 未TC")).toEqual({ key: "flask-t25", confidence: "mid" });
    for (const name of ["耐思 细胞培养板 6孔 未TC 泡壳装", "6-well plate, non-TC", "耐思 细胞培养板 96孔 U底 TC", "细胞培养皿150mm，TC", "多层细胞培养瓶-透气盖", "PC冻存盒81格"]) {
      expect([name, m(name)]).toEqual([name, null]);
    }
    expect(m("IPHASE Collagen Coated Plate, 24 wells")).toEqual({ key: "plate-24", confidence: "mid" });
  });
  it("通用耗材、培养基与常用试剂单品", () => {
    const cases: [string, string][] = [
      ["一次性细菌培养皿，60x15 mm", "bact-dish"], ["巴氏吸管/纸塑灭菌 3ml", "pasteur"], ["一次性加样槽V型 50ml", "reservoir-50"],
      ["专利涂层无粉乳胶手套M号", "glove-m"], ["医用垃圾袋 PE材质", "trash-bag"], ["液氮标签纸，2列", "cryolabel"],
      ["DMEM，高糖", "dmem"], ["DMEM/F-12培养基（1:1）", "dmem-f12"], ["OPTI-MEM", "optimem"], ["RPMI 1640 培养基", "rpmi"],
      ["PBS，pH 7.4", "pbs"], ["TRYPSIN 0.25% EDTA", "trypsin"], ["PENICILLIN STREPTOMYCIN", "pen-strep"], ["cell banker2 无血清型细胞冻存液", "freeze-medium"],
      ["QuickExtractM DNA Extraction Solution", "quickextract"], ["Lipofectamine™ MessengerMAX™ 转染试剂", "messengermax"],
      ["jetOPTIMUS", "jetoptimus"], ["DH5α 化学感受态细胞", "dh5a"], ["货号：C502-03 名称：DH5α 化学感受态细胞", "dh5a"], ["2 × Phanta Max Master Mix (Dye Plus)", "phanta-max"],
    ];
    for (const [name, key] of cases) expect([name, m(name)?.key]).toEqual([name, key]);
    expect(m("jetMessenger", "", "", "polyplus")).toEqual({ key: "jetoptimus", confidence: "low" });
    expect(m("2 × Phanta Ultra Master Mix")).toEqual({ key: "phanta-max", confidence: "low" });
  });
  it("像试剂盒/抗体的降为低把握，OA 小类与槽位不符降为中；长尾不归位", () => {
    expect(m("人 alpha 1 Antitrypsin ELISA试剂盒")).toBeNull();
    expect(m("96 孔 PCR 产物纯化试剂盒")).toBeNull();
    expect(m("示例 Trypsin 检测试剂盒")?.confidence).toBe("low");
    expect(m("Polyplus jetOPTIMUS DNA转染试剂", "101000006-1.5ml")?.key).toBe("jetoptimus");
    expect(m("DMEM 培养基", "", "耗材")).toEqual({ key: "dmem", confidence: "mid" });
    expect(m("200ul 吸头", "", "生物试剂")).toEqual({ key: "tip-200", confidence: "mid" });
    for (const name of ["Anti-(G4S)n mAb FITC GS-ARFT25", "小鼠耳标号", "MP 裂解介质管D", "CYNOM-K1完全培养基", "原代肝细胞", "Combitips advanced 10 mL"]) {
      expect([name, m(name)]).toEqual([name, null]);
    }
  });
});
