import { MaterialError } from "./materials-data";

// 常用耗材的类别与关键词只用于「从采购记录生成候选」，库存条目的类别由管理员确认。
// 类别名写成「大类/子类」（如「塑料耗材/吸头」），页面标签卡按大类（「/」前的部分）汇总和过滤。
export interface StockCategory {
  name: string;
  keywords: string[];
}

// 三态：已用完（数量 0）、需复核（从未核对或超过期限未核对）、正常。不再使用安全库存。
export type StockStatus = "out" | "stale" | "ok";

export interface StockLike {
  quantity: number;
  last_checked_at: Date | string | null;
}

// 超过该天数未核对即提示复核；不自动改数量。
export const STOCK_STALE_DAYS = 30;

// 关键词中英双语：台账里不少品名只有英文（如 PENICILLIN STREPTOMYCIN）。
// 不收「glutamax」：采购记录里它只出现在 RPMI/IMDM 培养基的名称中，收了会把培养基误归到添加物。
const DEFAULT_STOCK_CATEGORIES: StockCategory[] = [
  { name: "普通用品/手套", keywords: ["手套", "丁腈", "乳胶手套", "glove", "nitrile"] },
  { name: "普通用品/口罩帽鞋套", keywords: ["口罩", "鞋套", "袖套", "头套", "一次性帽", "实验服", "mask", "shoecover"] },
  { name: "普通用品/纸品清洁", keywords: ["擦手纸", "擦拭纸", "纸巾", "垃圾袋", "酒精", "75%乙醇", "消毒", "kimwipes", "wipes"] },
  { name: "普通用品/标签打印", keywords: ["标签", "碳带", "记号笔", "cryolabel"] },
  { name: "塑料耗材/吸头", keywords: ["吸头", "枪头", "滤芯吸头", "分液管", "tip", "tips", "combitips"] },
  { name: "塑料耗材/离心管冻存管", keywords: ["离心管", "ep管", "冻存管", "cryovial", "centrifugetube", "microtube", "safe-lock"] },
  { name: "塑料耗材/移液管", keywords: ["移液管", "巴氏吸管", "serological", "serologicalpipet"] },
  { name: "塑料耗材/PCR板连管封膜", keywords: ["pcr板", "pcr管", "连管", "联管", "联排管", "裙边", "封板膜", "封口膜", "封膜", "pcrplate", "striptube", "sealingfilm", "microamp"] },
  { name: "塑料耗材/培养板皿", keywords: ["培养板", "孔板", "培养皿", "培养瓶", "transwell", "小室", "dish", "flask", "wellplate", "cellcultureplate", "24孔", "48孔"] },
  { name: "塑料耗材/瓶槽盒架", keywords: ["加样槽", "冻存盒", "冰盒", "吸头盒", "试剂瓶", "血清瓶", "离心管架", "reservoir", "cryobox"] },
  { name: "塑料耗材/滤器", keywords: ["滤器", "滤膜", "细胞筛", "过滤器", "超滤管", "strainer", "syringefilter"] },
  { name: "塑料耗材/研磨管电转耗材", keywords: ["裂解介质管", "研磨管", "电转杯", "电转", "nucleocuvette", "cuvette", "lysingmatrix"] },
  { name: "生物试剂/培养基", keywords: ["培养基", "dmem", "rpmi", "imdm", "emem", "opti-mem", "optimem", "methocult", "medium"] },
  { name: "生物试剂/添加物消化", keywords: ["血清", "fbs", "双抗", "青链霉素", "penicillin", "streptomycin", "胰酶", "trypsin", "accutase", "pbs", "dpbs", "生理盐水", "冻存液", "cellbanker", "neaa"] },
  { name: "生物试剂/转染", keywords: ["转染", "lipofectamine", "messengermax", "polyplus", "jetprime", "jetoptimus", "eztrans", "transfection"] },
  { name: "试剂盒/核酸提取纯化", keywords: ["提取试剂盒", "纯化试剂盒", "isolation", "quickextract", "fastpure", "cleanbeads", "磁珠", "minikit", "purification"] },
  { name: "试剂盒/分子克隆PCR", keywords: ["mastermix", "pcrmix", "premix", "感受态", "competent", "无缝克隆", "连接酶", "goldengate", "phanta", "cloning"] },
  { name: "试剂盒/逆转录RNA", keywords: ["逆转录", "racekit", "smarterrace", "trizol", "hiscript", "reversetranscri"] },
  { name: "试剂盒/检测试剂盒", keywords: ["elisa", "elisakit", "elisa试剂盒", "assaykit", "assaysystem", "检测试剂盒", "ribogreen", "检测盒"] },
  { name: "试剂盒/核酸染料", keywords: ["核酸染料", "gelred", "yeared", "sybr", "goldview"] },
  { name: "其他", keywords: [] },
];

const DEFAULT_KEYWORDS = new Map(DEFAULT_STOCK_CATEGORIES.map((c) => [c.name, c.keywords]));
const MAX_CATEGORIES = 50;

export function normalizeStockText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function parseCategory(value: unknown): StockCategory {
  const name = typeof value === "string" ? value : value && typeof value === "object" && "name" in value ? (value as { name: unknown }).name : null;
  if (typeof name !== "string" || !name.trim()) throw new Error();
  const trimmed = name.trim();
  const rawKeywords =
    value && typeof value === "object" && "keywords" in value ? (value as { keywords: unknown }).keywords : DEFAULT_KEYWORDS.get(trimmed);
  const keywords = rawKeywords === undefined ? [] : rawKeywords;
  if (!Array.isArray(keywords) || keywords.length > MAX_CATEGORIES || keywords.some((k) => typeof k !== "string" || !k.trim() || k.length > 50)) {
    throw new Error();
  }
  return { name: trimmed, keywords: keywords.map((k: string) => normalizeStockText(k)) };
}

// 支持 [{"name":"吸头","keywords":["吸头"]}]，也支持 ["吸头","培养基"]（沿用内置关键词）。
export function stockCategories(raw = process.env.MATERIAL_STOCK_CATEGORIES_JSON): StockCategory[] {
  if (!raw) return DEFAULT_STOCK_CATEGORIES;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length || parsed.length > MAX_CATEGORIES) throw new Error();
    const categories = parsed.map(parseCategory);
    if (new Set(categories.map((c) => c.name)).size !== categories.length) throw new Error();
    return categories;
  } catch {
    throw new MaterialError("常用耗材类别配置无效，请联系管理员", 503);
  }
}

// 大类 =「/」前的部分；没有「/」的类别（如「其他」）自成一个大类。
export function stockGroup(category: string): string {
  const index = category.indexOf("/");
  return index < 0 ? category : category.slice(0, index);
}

export function stockSubcategory(category: string): string {
  const index = category.indexOf("/");
  return index < 0 ? "" : category.slice(index + 1);
}

export function stockGroups(categories: StockCategory[]): string[] {
  return [...new Set(categories.map((c) => stockGroup(c.name)))];
}

// 命中多个类别时取匹配到的最长关键词（「pcr板」优先于「孔板」），一样长时按配置顺序。
export function classifyConsumable(text: string, categories: StockCategory[]): string | null {
  const hay = normalizeStockText(text);
  if (!hay) return null;
  let best: { name: string; length: number } | null = null;
  for (const category of categories) {
    for (const keyword of category.keywords) {
      if (keyword && hay.includes(keyword) && (!best || keyword.length > best.length)) best = { name: category.name, length: keyword.length };
    }
  }
  return best?.name ?? null;
}

export function stockStale(item: StockLike, now = Date.now()): boolean {
  if (!item.last_checked_at) return true;
  const checked = new Date(item.last_checked_at).getTime();
  return !Number.isFinite(checked) || now - checked > STOCK_STALE_DAYS * 24 * 60 * 60 * 1000;
}

export function stockStatus(item: StockLike, now = Date.now()): StockStatus {
  // 从未核对过的条目数量未知，不能当作 0（已用完），归为需复核。
  if (!item.last_checked_at) return "stale";
  if (item.quantity <= 0) return "out";
  return stockStale(item, now) ? "stale" : "ok";
}

export function stockAmount(value: unknown, label = "数量"): number {
  const text = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!text) throw new MaterialError(`${label}不能为空`);
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) throw new MaterialError(`${label}须为 0 至 10 亿之间的数字`);
  // 与 numeric(12,2) 对齐，避免数据库四舍五入后与界面显示不一致。
  return Math.round(amount * 100) / 100;
}

export function stockText(value: unknown, label: string, max: number, required = false): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (required && !text) throw new MaterialError(`请填写${label}`);
  if (text.length > max) throw new MaterialError(`${label}不能超过 ${max} 个字符`);
  return text;
}

export function stockNote(value: unknown): string {
  const text = String(value ?? "").trim();
  if (text.length > 500) throw new MaterialError("备注不能超过 500 个字符");
  return text;
}

export function stockCategory(name: unknown, categories: StockCategory[]): string {
  const value = String(name ?? "").trim();
  if (!categories.some((c) => c.name === value)) throw new MaterialError("请选择配置中的耗材类别");
  return value;
}
