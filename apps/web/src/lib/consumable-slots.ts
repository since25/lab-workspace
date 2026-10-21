// 常用耗材的固定规格槽位：库存数记在槽位上，品牌货号只用于识别采购入库。
// 模板按 2026-10 生产采购台账反推、经用户确认（非 TC 板、U 底板、150mm 皿、多层瓶不算常用；培养添加物并入培养基）。
// 匹配规则只给「建议槽位 + 把握」，是否归入由管理员在核对工作台确认。

export type SlotConfidence = "high" | "mid" | "low";

export interface SlotTemplate {
  key: string;
  category: string;
  name: string;
  unit: string;
  brand?: string;
  spec_model?: string;
}

export interface SlotMatch {
  key: string;
  confidence: SlotConfidence;
}

const t = (key: string, category: string, name: string, unit: string, extra: Partial<SlotTemplate> = {}): SlotTemplate =>
  ({ key, category, name, unit, ...extra });

export const SLOT_TEMPLATES: SlotTemplate[] = [
  t("plate-6", "细胞耗材/细胞培养板", "6孔板 TC", "箱"),
  t("plate-12", "细胞耗材/细胞培养板", "12孔板 TC", "箱"),
  t("plate-24", "细胞耗材/细胞培养板", "24孔板 TC", "箱"),
  t("plate-48", "细胞耗材/细胞培养板", "48孔板 TC", "箱"),
  t("plate-96", "细胞耗材/细胞培养板", "96孔板 TC", "箱"),
  t("dish-60", "细胞耗材/培养皿", "60mm 细胞培养皿", "箱"),
  t("dish-100", "细胞耗材/培养皿", "100mm 细胞培养皿", "箱"),
  t("flask-t25", "细胞耗材/培养瓶", "T25 培养瓶", "箱"),
  t("flask-t75", "细胞耗材/培养瓶", "T75 培养瓶", "箱"),
  t("strainer-40", "细胞耗材/细胞筛", "40µm 细胞筛", "箱"),
  t("strainer-70", "细胞耗材/细胞筛", "70µm 细胞筛", "箱"),
  t("cryovial-2", "细胞耗材/冻存管", "2mL 冻存管", "箱"),
  t("tip-10", "塑料耗材/吸头", "10µL 吸头", "箱"),
  t("tip-10f", "塑料耗材/吸头", "10µL 滤芯吸头", "箱"),
  t("tip-200", "塑料耗材/吸头", "200µL 吸头", "箱"),
  t("tip-200f", "塑料耗材/吸头", "200µL 滤芯吸头", "箱"),
  t("tip-1000", "塑料耗材/吸头", "1000/1250µL 吸头", "箱"),
  t("tip-1000f", "塑料耗材/吸头", "1000/1250µL 滤芯吸头", "箱"),
  t("tube-1.5", "塑料耗材/离心管", "1.5mL 离心管", "箱"),
  t("tube-2", "塑料耗材/离心管", "2.0mL 离心管", "箱"),
  t("tube-15", "塑料耗材/离心管", "15mL 离心管", "箱"),
  t("tube-50", "塑料耗材/离心管", "50mL 离心管", "箱"),
  t("pipet-5", "塑料耗材/血清移液管", "5mL 血清移液管", "箱"),
  t("pipet-10", "塑料耗材/血清移液管", "10mL 血清移液管", "箱"),
  t("pipet-25", "塑料耗材/血清移液管", "25mL 血清移液管", "箱"),
  t("pipet-50", "塑料耗材/血清移液管", "50mL 血清移液管", "箱"),
  t("pcr-strip", "塑料耗材/PCR耗材", "0.2mL 8连管", "箱"),
  t("pcr-cap", "塑料耗材/PCR耗材", "8连管管盖", "箱"),
  t("pcr-plate", "塑料耗材/PCR耗材", "96孔 PCR 板", "箱"),
  t("seal", "塑料耗材/PCR耗材", "封板膜 / 封口膜", "包"),
  t("bact-dish", "通用耗材/实验耗材", "60mm 细菌培养皿", "箱"),
  t("pasteur", "通用耗材/实验耗材", "巴氏吸管", "箱"),
  t("reservoir-10", "通用耗材/实验耗材", "10mL 加样槽", "箱"),
  t("reservoir-50", "通用耗材/实验耗材", "50mL 加样槽", "箱"),
  t("glove-s", "通用耗材/手套", "手套 S号", "箱"),
  t("glove-m", "通用耗材/手套", "手套 M号", "箱"),
  t("glove-l", "通用耗材/手套", "手套 L号", "箱"),
  t("trash-bag", "通用耗材/日用防护", "医用垃圾袋", "包"),
  t("mask", "通用耗材/日用防护", "口罩", "箱"),
  t("towel", "通用耗材/日用防护", "擦手纸", "箱"),
  t("cryolabel", "通用耗材/日用防护", "液氮标签", "卷"),
  t("shoe-cover", "通用耗材/日用防护", "鞋套", "袋"),
  t("dmem", "培养基/基础培养基", "DMEM 高糖", "瓶"),
  t("dmem-f12", "培养基/基础培养基", "DMEM/F-12", "瓶"),
  t("rpmi", "培养基/基础培养基", "RPMI 1640", "瓶"),
  t("imdm", "培养基/基础培养基", "IMDM", "瓶"),
  t("optimem", "培养基/基础培养基", "Opti-MEM", "瓶"),
  t("fbs", "培养基/添加物", "胎牛血清 FBS", "瓶"),
  t("pen-strep", "培养基/添加物", "青链霉素（双抗）", "瓶"),
  t("trypsin", "培养基/添加物", "胰酶", "瓶"),
  t("pbs", "培养基/添加物", "PBS", "瓶"),
  t("saline", "培养基/添加物", "生理盐水", "瓶"),
  t("freeze-medium", "培养基/添加物", "细胞冻存液", "瓶"),
  t("quickextract", "常用试剂/单品", "QuickExtract DNA 提取液", "瓶", { brand: "Lucigen" }),
  t("messengermax", "常用试剂/单品", "Lipofectamine MessengerMAX", "支", { brand: "Thermo Fisher" }),
  t("jetoptimus", "常用试剂/单品", "jetOPTIMUS 转染试剂", "支", { brand: "Polyplus" }),
  t("dh5a", "常用试剂/单品", "DH5α 感受态细胞", "袋"),
  t("phanta-max", "常用试剂/单品", "2× Phanta Max Master Mix", "包", { brand: "诺唯赞", spec_model: "P525-03" }),
];

const TEMPLATE_BY_KEY = new Map(SLOT_TEMPLATES.map((s) => [s.key, s]));

export function slotTemplate(key: string): SlotTemplate | undefined {
  return TEMPLATE_BY_KEY.get(key);
}

const squash = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
const pick = (text: string, pairs: [RegExp, string][]) => pairs.find(([re]) => re.test(text))?.[1] ?? null;

type Rule = (text: string) => string | SlotMatch | null;

// 规则按顺序尝试，第一条命中即返回；顺序有意义（如 PCR、冻存管、细菌培养皿要排在通用规则前）。
const RULES: Rule[] = [
  // 常用试剂单品
  (x) => (x.includes("quickextract") ? "quickextract" : null),
  (x) => (x.includes("messengermax") ? "messengermax" : null),
  (x) => (x.includes("jetoptimus") ? "jetoptimus" : x.includes("polyplus") ? { key: "jetoptimus", confidence: "low" } : null),
  (x) => (/dh5α|dh5a/.test(x) ? "dh5a" : null),
  (x) => (x.includes("phantamax") ? "phanta-max" : x.includes("phanta") ? { key: "phanta-max", confidence: "low" } : null),
  // PCR 耗材（要在培养板、离心管之前，「96孔板封膜」「PCR管」不能落到板子或离心管）
  (x) => {
    if (/8联|8连|八连|联排管|striptube/.test(x)) return x.includes("管盖") ? "pcr-cap" : "pcr-strip";
    if (/pcr板|pcrplate/.test(x)) return "pcr-plate";
    if (/封膜|封板膜|封口膜|密封箔|parafilm|sealingfilm/.test(x)) return "seal";
    return null;
  },
  // 冻存管（「外旋」「冻存管」，但冻存盒不算）
  (x) => (/冻存管|cryovial|外旋/.test(x) && !/盒|box/.test(x) ? "cryovial-2" : null),
  // 吸头：容量 × 滤芯
  (x) => {
    if (/combitips|分液/.test(x) || !/吸头|枪头|tip|qsp/.test(x)) return null;
    const vol = pick(x, [[/(?<![\d.])(0\.5-)?10(μl|ul)|(?<!\d)10μ|2-20|t-10/, "10"], [/(?<!\d)200(μ|u)|20-200|t-200|tf-200/, "200"], [/1250|1000/, "1000"]]);
    if (!vol) return null;
    const filter = /滤芯|tf-|tf112|ft00|filter/.test(x) && !x.includes("无滤芯");
    return `tip-${vol}${filter ? "f" : ""}`;
  },
  // 细菌培养皿 / 细胞培养皿（150mm 不算常用）
  (x) => {
    if (!/培养皿|dish/.test(x)) return null;
    if (x.includes("细菌")) return "bact-dish";
    if (x.includes("150466")) return "dish-100";
    if (/150|145mm/.test(x)) return null;
    return pick(x, [[/100mm|(?<!\d)100x/, "dish-100"], [/60mm|pym-60|(?<!\d)60x/, "dish-60"]]);
  },
  // 细胞培养板：孔数，只收 TC 平底；非 TC、U 底不算常用，包被板给中等把握
  (x) => {
    if (/pcr|超滤|微孔板|g-rex|磁力|冰盒|管架|冻存盒|电转|离心管盒|深孔|封膜|适用于/.test(x)) return null;
    const m = x.match(/(6|12|24|48|96)(孔|-?wells?)/);
    if (!m || !/板|plate|泡壳|tc/.test(x)) return null;
    if (/未tc|非tc|non-tc|nottreat|u底|圆底|v底/.test(x)) return null;
    return { key: `plate-${m[1]}`, confidence: /包被|coated|collagen|poly-?d/.test(x) ? "mid" : "high" };
  },
  // 培养瓶（多层瓶不算常用）
  (x) => {
    if (!/培养瓶|flask|(?<![a-z])t(25|75)|cantedneck/.test(x) || x.includes("多层")) return null;
    const key = pick(x, [[/(?<![a-z])t25|25cm/, "flask-t25"], [/(?<![a-z])t75|75cm/, "flask-t75"]]);
    // 台账里的培养瓶都是未 TC 的；培养瓶仍算常用，非 TC 只降为中等把握，由管理员确认。
    return key && { key, confidence: /未tc|非tc|nottreat/.test(x) ? "mid" : "high" };
  },
  (x) => (/细胞过滤器|细胞筛|strainer/.test(x) ? pick(x, [[/40(um|μm)/, "strainer-40"], [/70(um|μm)/, "strainer-70"]]) : null),
  // 离心管：容量
  (x) => {
    if (/抗凝|裂解|超滤|冻存|管架|管盒|pcr|8联|8连|测试|test|培养管|转染|试剂|磁力/.test(x)) return null;
    if (!/离心管|ep管|centrifuge|microtube|yb-1\.5|yb-2|mct-150/.test(x)) return null;
    return pick(x, [[/(?<![\d.])50ml|yb0010-50|dz050|jz050/, "tube-50"], [/(?<![\d.])15ml|yb-15/, "tube-15"], [/1\.5ml|yb-1\.5|mct-150/, "tube-1.5"], [/2\.0ml|(?<![\d.])2ml|yb-2/, "tube-2"]]);
  },
  (x) => {
    if (!/移液管|serological/.test(x)) return null;
    return pick(x, [[/(?<![\d.])50ml|170358/, "pipet-50"], [/(?<![\d.])25ml|170357/, "pipet-25"], [/(?<![\d.])10ml|yb-10/, "pipet-10"], [/(?<![\d.])5ml|yb-5|170355/, "pipet-5"]]);
  },
  (x) => (/巴氏吸管|吸量管|pasteur/.test(x) ? "pasteur" : null),
  (x) => (x.includes("加样槽") || x.includes("reservoir") ? pick(x, [[/50ml|-50/, "reservoir-50"], [/10ml/, "reservoir-10"]]) : null),
  (x) => {
    if (!/手套|glove/.test(x)) return null;
    const size = x.match(/([sml])号/)?.[1] ?? x.match(/-([sml])(?![a-z])/)?.[1];
    return size ? `glove-${size}` : null;
  },
  (x) => pick(x, [[/垃圾袋/, "trash-bag"], [/口罩/, "mask"], [/擦手纸|擦拭纸/, "towel"], [/鞋套/, "shoe-cover"]]),
  (x) => (/液氮|低温|cryo/.test(x) && /标签|label/.test(x) ? "cryolabel" : null),
  // 培养基与添加物
  (x) => {
    if (x.includes("完全培养基")) return null;
    return pick(x, [
      [/dmem\/f-?12|dmemf12/, "dmem-f12"], [/dmem/, "dmem"], [/opti-?mem/, "optimem"], [/imdm/, "imdm"], [/rpmi/, "rpmi"],
    ]);
  },
  (x) => pick(x, [
    [/fbs|胎牛血清/, "fbs"], [/双抗|青链霉素|penicillin/, "pen-strep"], [/(?<!anti)trypsin|胰酶/, "trypsin"],
    [/(?<![a-z])d?pbs(?!t)/, "pbs"], [/生理盐水|0\.9%nacl/, "saline"], [/冻存液|cellbanker|bambanker/, "freeze-medium"],
  ]),
];

const KIT_WORDS = /试剂盒|kit|elisa|assay|抗体|antibod|mab(?![a-z])/;
const PLASTIC_GROUPS = ["细胞耗材", "塑料耗材", "通用耗材"];

// 把握：规则本身给的把握为准；名称像试剂盒/抗体的降为「低」；OA 小类与槽位大类不符的降为「中」。
export function matchSlot(row: { item_name: string; brand: string; spec_model: string; minor_category?: string }): SlotMatch | null {
  const text = squash(`${row.item_name} ${row.brand} ${row.spec_model}`);
  if (!text) return null;
  for (const rule of RULES) {
    const hit = rule(text);
    if (!hit) continue;
    const match: SlotMatch = typeof hit === "string" ? { key: hit, confidence: "high" } : hit;
    const group = TEMPLATE_BY_KEY.get(match.key)?.category.split("/")[0] ?? "";
    if (group !== "常用试剂" && KIT_WORDS.test(text)) return { ...match, confidence: "low" };
    const minor = row.minor_category ?? "";
    const plasticSlot = PLASTIC_GROUPS.includes(group);
    const mismatch = minor && (plasticSlot ? /试剂/.test(minor) : minor === "耗材");
    if (mismatch && match.confidence === "high") return { ...match, confidence: "mid" };
    return match;
  }
  return null;
}
