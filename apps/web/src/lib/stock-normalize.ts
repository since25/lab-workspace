// 常用耗材的异名归一：同一品因品牌别名、名称同义词和脏写法被拆成多行时，入库和关联采购记录前先归一。
// 只做识别用的「归一键」和展示用的清理，不改 material_items 原始数据；单位归一策略未定，这里不处理单位。

// 品牌别名表：每组第一个为展示用的标准名，其余写法（比较时忽略大小写和空格）都视为同一品牌。
export const BRAND_ALIASES: string[][] = [
  ["Thermo Fisher", "Thermo", "ThermoFisher", "Thermo Fisher Scientific", "Thermo Scientific", "赛默飞", "赛默飞世尔", "Invitrogen", "ABI", "Applied Biosystems"],
  ["诺唯赞", "Vazyme", "南京诺唯赞"],
  ["泰坦", "Titan", "泰坦科技", "探索平台"],
];

// 品目同义词表：按顺序在归一后的名称上替换，把同一品目的不同叫法统一成一个写法。
export const ITEM_SYNONYMS: [RegExp, string][] = [
  [/(\d+)(?:孔|-?wells?)(?:细胞)?(?:培养)?(?:板|plates?)/g, "$1孔板"],
  [/(?:8|八)(?:联|连)(?:排)?(?:pcr)?(?:管|strips?)|8-?strips?(?:pcr)?(?:tubes?)?/g, "8连管"],
  [/枪头/g, "吸头"],
];

const squash = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

const BRAND_INDEX = new Map(BRAND_ALIASES.flatMap((group) => group.map((alias) => [squash(alias), group[0]] as const)));

// 「Titan/泰坦」「诺唯赞（Vazyme）」这类组合写法按分隔符拆开，任一部分命中别名即归到标准名。
export function canonicalBrand(raw: string): string {
  const text = String(raw ?? "").trim();
  const whole = BRAND_INDEX.get(squash(text));
  if (whole) return whole;
  for (const part of text.split(/[\/|,，、;；()（）]+/)) {
    const hit = BRAND_INDEX.get(squash(part));
    if (hit) return hit;
  }
  return text;
}

// 清理「货号:xxx 名称:xxx」脏写法：名称取「名称:」后的内容，货号在规格为空时可作为规格。
const FIELD = /(货号|名称|规格)\s*[:：]\s*/g;
function splitFields(raw: string): Record<string, string> | null {
  const marks = [...raw.matchAll(FIELD)];
  if (!marks.some((m) => m[1] === "名称")) return null;
  const fields: Record<string, string> = {};
  marks.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : raw.length;
    fields[m[1]] = raw.slice(start, end).trim().replace(/[,，;；]$/, "").trim();
  });
  return fields;
}

export function cleanItemName(raw: string): string {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ");
  return splitFields(text)?.["名称"] || text;
}

// 「200 tests」「200Test」「200 T」统一写成「200T」。
export function cleanSpec(raw: string, itemName = ""): string {
  let text = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!text) text = splitFields(String(itemName ?? "").trim())?.["货号"] ?? "";
  return text.replace(/(\d+)\s*(?:tests?|t)(?![a-z])/gi, "$1T");
}

export function normalizeItemName(raw: string): string {
  return ITEM_SYNONYMS.reduce((name, [pattern, to]) => name.replace(pattern, to), squash(cleanItemName(raw)));
}

export interface StockIdentity {
  item_name: string;
  brand: string;
  spec_model: string;
}

// 名称+品牌+规格的归一键：用于候选去重合并，以及库存条目与采购记录的关联。
export function stockIdentityKey(row: StockIdentity): string {
  return [normalizeItemName(row.item_name), squash(canonicalBrand(row.brand)), squash(cleanSpec(row.spec_model, row.item_name))].join("|");
}

export function normalizeUnit(raw: string): string {
  return squash(String(raw ?? ""));
}
