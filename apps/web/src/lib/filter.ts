// 筛选用的文本规范化：Unicode NFKC（全角转半角、兼容字符统一）、忽略大小写、去掉空白
export function normalizeForMatch(s: string): string {
  return s.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}

// 关键词按空格拆成多段，每段都要出现在选项文字中（顺序不限）
export function matchesQuery(text: string, query: string): boolean {
  const parts = query.normalize("NFKC").split(/\s+/).map(normalizeForMatch).filter(Boolean);
  if (!parts.length) return true;
  const t = normalizeForMatch(text);
  return parts.every((p) => t.includes(p));
}
