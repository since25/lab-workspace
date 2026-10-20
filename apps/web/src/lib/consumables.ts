import { MaterialError } from "./materials-data";

// 常用耗材的类别与关键词只用于「从采购记录生成候选」，库存条目的类别由管理员确认。
export interface StockCategory {
  name: string;
  keywords: string[];
}

export type StockStatus = "unchecked" | "out" | "low" | "ok";

export interface StockLike {
  quantity: number;
  safety_stock: number;
  last_checked_at: Date | string | null;
}

// 超过该天数未核对即提示复核；不自动改数量。
export const STOCK_STALE_DAYS = 30;

const DEFAULT_STOCK_CATEGORIES: StockCategory[] = [
  { name: "吸头", keywords: ["吸头", "枪头", "tip", "tips", "滤芯吸头"] },
  { name: "细胞培养板", keywords: ["培养板", "孔板", "培养皿", "transwell", "小室", "insert"] },
  { name: "移液管", keywords: ["移液管", "pipette", "serological", "巴氏吸管", "吸管"] },
  { name: "离心管", keywords: ["离心管", "ep管", "eppendorf", "冻存管", "cryovial"] },
  { name: "培养基", keywords: ["培养基", "dmem", "rpmi", "f12", "f-12", "memα", "mem-α", "medium", "血清", "fbs"] },
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

export function classifyConsumable(text: string, categories: StockCategory[]): string | null {
  const hay = normalizeStockText(text);
  if (!hay) return null;
  for (const category of categories) {
    if (category.keywords.some((keyword) => keyword && hay.includes(keyword))) return category.name;
  }
  return null;
}

export function stockStatus(item: StockLike): StockStatus {
  // 从未核对过的条目数量未知，不能当作 0 或缺货。
  if (!item.last_checked_at) return "unchecked";
  if (item.quantity <= 0) return "out";
  if (item.safety_stock > 0 && item.quantity <= item.safety_stock) return "low";
  return "ok";
}

export function stockStale(item: StockLike, now = Date.now()): boolean {
  if (!item.last_checked_at) return true;
  const checked = new Date(item.last_checked_at).getTime();
  return !Number.isFinite(checked) || now - checked > STOCK_STALE_DAYS * 24 * 60 * 60 * 1000;
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
