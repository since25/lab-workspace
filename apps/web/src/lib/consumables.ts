import { MaterialError } from "./materials-data";
import { SLOT_TEMPLATES } from "./consumable-slots";

// 类别名写成「大类/子类」（如「塑料耗材/吸头」），页面标签卡按大类（「/」前的部分）汇总和过滤。
// 2026-10 起库存按固定规格槽位管理，采购归类由 consumable-slots.ts 的规则完成；keywords 仅为兼容旧配置保留，不再使用。
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

// 默认类别 = 槽位模板里出现的类别（按模板顺序）+「其他」（手工新增的杂项）。
const DEFAULT_STOCK_CATEGORIES: StockCategory[] = [
  ...[...new Set(SLOT_TEMPLATES.map((s) => s.category))].map((name) => ({ name, keywords: [] })),
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
