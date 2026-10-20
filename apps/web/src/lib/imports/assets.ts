import type { ImportIssue } from "./cells";
import { type Cell, parseNumber, text } from "./sheet";

export interface AssetRow {
  asset_code: string;
  asset_code_new: string;
  asset_name: string;
  spec_model: string;
  category: string;
  quantity: number | null;
  location: string;
  department: string;
  user_name: string;
}

const COLS: Record<keyof AssetRow, string[]> = {
  // `固定资产新编号（2023.7月起）` 与 `更改后固定资产编号(20211102)` 等带前后缀的表头不能写死，见下方单独识别
  asset_code: ["固定资产编号", "资产编号"],
  asset_code_new: [],
  asset_name: ["固定资产名称", "资产名称"],
  spec_model: ["规格型号"],
  category: ["类别名称", "类别"],
  quantity: ["数量"],
  location: ["存放地点"],
  department: ["使用部门"],
  user_name: ["使用人"],
};
const NEW_CODE_PREFIX = "固定资产新编号";
// 表头常见文字：一行里出现两个以上就认为是表中重复出现的表头行（台账里旧版块会再写一次表头）
const HEADER_LABELS = new Set([
  ...Object.values(COLS).flat(), NEW_CODE_PREFIX, "序号", "计量单位", "购置日期", "使用年限", "到期日",
  "单价", "金额", "使用状态", "备注", "转固日期",
]);
const NOISE_NAMES = new Set(["合计", "小计", "总计", ...COLS.asset_name]);
const isHeaderRow = (cells: string[]) => cells.filter((c) => HEADER_LABELS.has(c)).length >= 2;

// 解析固定资产台账（全量入库，不按部门过滤；展示范围由页面查询时的部门配置决定）：
// - 读取所有含「固定资产名称」「使用部门」表头的工作表，跳过名为 SheetN 的草稿/旧版工作表；
// - 跳过台账中重复出现的表头行与「合计」行，跳过缺少使用部门的行（在预览里按行号提示）；
// - 资产编号（旧编号与新编号）随行入库，用于区分同名同规格、存放地点不同的资产，并作为跨表去重依据。
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
    idx.asset_code_new = header.findIndex((h) => h.startsWith(NEW_CODE_PREFIX));
    // 没有「固定资产编号」的工作表（如「未入账」）用「更改后固定资产编号」这类列兜底，但不认「配套设备资产编号」
    if (idx.asset_code < 0) {
      idx.asset_code = header.findIndex((h) => h.includes("编号") && !h.includes("配套") && !h.startsWith(NEW_CODE_PREFIX));
    }
    let count = 0;
    for (let i = hi + 1; i < sheet.rows.length; i++) {
      const r = sheet.rows[i];
      const cells = r.map((c) => text(c));
      if (isHeaderRow(cells)) {
        issues.push({ sheet: sheet.name, row: i + 1, message: "表中重复出现的表头行，跳过" });
        continue;
      }
      const get = (k: keyof AssetRow) => (idx[k] >= 0 ? r[idx[k]] : null);
      const name = text(get("asset_name"));
      if (!name || NOISE_NAMES.has(name)) continue;
      const department = text(get("department"));
      if (!department) {
        issues.push({ sheet: sheet.name, row: i + 1, message: `「${name}」缺少使用部门，跳过` });
        continue;
      }
      const code = text(get("asset_code"));
      const newCode = text(get("asset_code_new"));
      const row: AssetRow = {
        asset_code: code,
        asset_code_new: newCode,
        asset_name: name,
        spec_model: text(get("spec_model")),
        category: text(get("category")),
        quantity: parseNumber(get("quantity")),
        location: text(get("location")),
        department,
        user_name: text(get("user_name")),
      };
      const key = code || newCode || JSON.stringify(row);
      if (seen.has(key)) {
        issues.push({ sheet: sheet.name, row: i + 1, message: code || newCode ? `资产编号 ${code || newCode} 已在前面导入，跳过` : "与前面一行完全相同，跳过" });
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

// 导入预览用的部门分布：管理员确认前能看到全量台账里都有哪些部门、各多少条
export function assetDepartments(rows: AssetRow[]): { department: string; rows: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.department, (counts.get(r.department) ?? 0) + 1);
  return [...counts].map(([department, n]) => ({ department, rows: n })).sort((a, b) => b.rows - a.rows || a.department.localeCompare(b.department, "zh-CN"));
}
