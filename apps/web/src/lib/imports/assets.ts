import { normalizeForMatch } from "../filter";
import type { ImportIssue } from "./cells";
import { type Cell, parseNumber, text } from "./sheet";

export interface AssetRow {
  asset_name: string;
  spec_model: string;
  category: string;
  quantity: number | null;
  location: string;
  department: string;
  user_name: string;
}

export const ASSET_DEPARTMENT = "研发部";

const COLS: Record<keyof AssetRow, string[]> = {
  asset_name: ["固定资产名称", "资产名称"],
  spec_model: ["规格型号"],
  category: ["类别名称", "类别"],
  quantity: ["数量"],
  location: ["存放地点"],
  department: ["使用部门"],
  user_name: ["使用人"],
};

// 解析固定资产台账：
// - 读取所有含「固定资产名称」「使用部门」表头的工作表，跳过名为 SheetN 的草稿/旧版工作表；
// - 只保留使用部门为研发部的行；
// - 资产编号只用于去重（同一编号在多个工作表出现时只导入一次），不入库。
export function parseAssetWorkbook(sheets: { name: string; rows: Cell[][] }[]): {
  rows: AssetRow[];
  issues: ImportIssue[];
  fatal: string | null;
  sheets_used: { sheet: string; rows: number }[];
} {
  const rows: AssetRow[] = [];
  const issues: ImportIssue[] = [];
  const used: { sheet: string; rows: number }[] = [];
  const seen = new Set<string>();
  const dept = normalizeForMatch(ASSET_DEPARTMENT);
  for (const sheet of sheets) {
    if (/^sheet\d*$/i.test(sheet.name.trim())) continue;
    const hi = sheet.rows.findIndex((r, i) => {
      const h = r.map((c) => text(c));
      return i < 5 && COLS.asset_name.some((n) => h.includes(n)) && h.includes("使用部门");
    });
    if (hi < 0) continue;
    const header = sheet.rows[hi].map((c) => text(c));
    const idx = Object.fromEntries(
      Object.entries(COLS).map(([k, names]) => [k, header.findIndex((h) => names.includes(h))])
    ) as Record<keyof AssetRow, number>;
    const codeIdx = header.findIndex((h) => h === "固定资产编号") >= 0 ? header.indexOf("固定资产编号") : header.findIndex((h) => h.includes("编号"));
    let count = 0;
    for (let i = hi + 1; i < sheet.rows.length; i++) {
      const r = sheet.rows[i];
      const get = (k: keyof AssetRow) => (idx[k] >= 0 ? r[idx[k]] : null);
      const name = text(get("asset_name"));
      if (!name || normalizeForMatch(text(get("department"))) !== dept) continue;
      const code = codeIdx >= 0 ? text(r[codeIdx]) : "";
      const row: AssetRow = {
        asset_name: name,
        spec_model: text(get("spec_model")),
        category: text(get("category")),
        quantity: parseNumber(get("quantity")),
        location: text(get("location")),
        department: text(get("department")),
        user_name: text(get("user_name")),
      };
      const key = code || JSON.stringify(row);
      if (seen.has(key)) {
        issues.push({ sheet: sheet.name, row: i + 1, message: code ? `资产编号 ${code} 已在前面导入，跳过` : "与前面一行完全相同，跳过" });
        continue;
      }
      seen.add(key);
      rows.push(row);
      count++;
    }
    used.push({ sheet: sheet.name, rows: count });
  }
  if (!used.length) return { rows, issues, fatal: "没有找到包含「固定资产名称」「使用部门」表头的工作表", sheets_used: used };
  return { rows, issues, fatal: null, sheets_used: used };
}
