import { HttpError } from "../http";
import { type GuideInput, parseGuide } from "../guides";
import type { ImportIssue } from "./cells";
import { type Cell, text } from "./sheet";

// 与导出模板一致的列名
export const GUIDE_HEADERS = ["名称", "靶点", "序列", "PAM", "链方向", "目标位置", "目标碱基", "编辑后碱基", "备注", "旁观位"];
const KEYS = ["name", "target", "sequence", "pam", "strand", "target_position", "target_base", "edited_base", "notes", "bystander_position"];

// 解析 Guide 导入文件：逐行用与单条新增相同的规则校验，不合格的行进入问题列表
export function parseGuideSheet(sheet: { name: string; rows: Cell[][] }): { rows: GuideInput[]; issues: ImportIssue[]; fatal: string | null } {
  const hi = sheet.rows.findIndex((r, i) => i < 10 && r.map((c) => text(c)).includes("序列") && r.map((c) => text(c)).includes("名称"));
  if (hi < 0) return { rows: [], issues: [], fatal: "找不到包含「名称」「序列」的表头，请使用导出的模板" };
  const header = sheet.rows[hi].map((c) => text(c));
  const rows: GuideInput[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();
  for (let i = hi + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    if (r.every((c) => text(c) === "")) continue;
    const body: Record<string, unknown> = {};
    GUIDE_HEADERS.forEach((h, k) => {
      const j = header.indexOf(h);
      if (j >= 0) body[KEYS[k]] = text(r[j]);
    });
    try {
      const g = parseGuide(body);
      if (seen.has(g.name)) {
        issues.push({ sheet: sheet.name, row: i + 1, message: `名称「${g.name}」在文件中重复，只保留第一条` });
        continue;
      }
      seen.add(g.name);
      rows.push(g);
    } catch (e) {
      issues.push({ sheet: sheet.name, row: i + 1, message: e instanceof HttpError ? e.message : String(e) });
    }
  }
  return { rows, issues, fatal: null };
}
