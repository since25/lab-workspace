// 把前端的排序参数转成安全的 ORDER BY：列名只能取白名单
export function orderBy(sp: URLSearchParams, allowed: Record<string, string>, fallback: string): string {
  const col = allowed[sp.get("sort") ?? ""];
  if (!col) return fallback;
  const dir = sp.get("dir") === "desc" ? "DESC" : "ASC";
  return `${col} ${dir} NULLS LAST, ${fallback}`;
}
