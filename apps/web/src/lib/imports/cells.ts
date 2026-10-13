import { type Cell, parseLooseDate, text } from "./sheet";

export interface CellRow {
  rack_no: number;
  layer_no: number;
  cell_name: string;
  source: string;
  passage: string;
  density: string;
  freezing_medium: string;
  tube_count: number | null;
  tube_count_raw: string;
  depositor: string;
  frozen_on: string | null;
  frozen_on_raw: string;
  needs_review: boolean;
  review_reason: string;
}

export interface ImportIssue {
  sheet: string;
  row: number; // 表格中的行号（从 1 开始）
  message: string;
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

export function parseLayer(v: string): number | null {
  const s = v.replace(/[层第\s]/g, "");
  if (!s) return null;
  if (CN_NUM[s]) return CN_NUM[s];
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

export function parseRack(v: string): number | null {
  const m = v.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? n : null;
}

// 原表各列：层数、细胞名称、来源、代次、细胞密度、冻存液、管数、存放人、放入时间（csv 另有「架号」）
const COLS = {
  rack: ["架号", "架子", "架"],
  layer: ["层数", "层", "层号"],
  name: ["细胞名称", "名称"],
  source: ["来源"],
  passage: ["代次"],
  density: ["细胞密度", "密度"],
  medium: ["冻存液"],
  tubes: ["管数"],
  depositor: ["存放人"],
  date: ["放入时间", "冻存日期", "日期"],
};

function findHeader(rows: Cell[][]): { index: number; col: Record<keyof typeof COLS, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].map((c) => text(c));
    if (!cells.includes("细胞名称")) continue;
    const col = {} as Record<keyof typeof COLS, number>;
    for (const [k, aliases] of Object.entries(COLS)) {
      col[k as keyof typeof COLS] = cells.findIndex((c) => aliases.includes(c));
    }
    return { index: i, col };
  }
  return null;
}

function parseTubes(v: Cell | undefined): { count: number | null; raw: string; ok: boolean } {
  const raw = text(v);
  if (!raw) return { count: null, raw: "", ok: true };
  const s = raw.replace(/管$/, "");
  if (/^\d+(\.0+)?$/.test(s)) return { count: Math.round(Number(s)), raw, ok: true };
  return { count: null, raw, ok: false };
}

// 解析整个冻存登记工作簿：每个工作表一个架子（表名含架号），或 csv 带「架号」列
export function parseCellWorkbook(sheets: { name: string; rows: Cell[][] }[]): { rows: CellRow[]; issues: ImportIssue[] } {
  const out: CellRow[] = [];
  const issues: ImportIssue[] = [];
  for (const sheet of sheets) {
    const header = findHeader(sheet.rows);
    if (!header) {
      issues.push({ sheet: sheet.name, row: 0, message: "找不到包含「细胞名称」的表头行，整张表已跳过" });
      continue;
    }
    const { col } = header;
    const sheetRack = parseRack(sheet.name);
    let layer: number | null = null;
    for (let i = header.index + 1; i < sheet.rows.length; i++) {
      const r = sheet.rows[i];
      const rowNo = i + 1;
      const get = (k: keyof typeof COLS) => (col[k] >= 0 ? r[col[k]] : null);
      const first = text(r[0]);
      if (/^note/i.test(first)) continue;
      const layerText = text(get("layer"));
      if (layerText) {
        const l = parseLayer(layerText);
        if (l === null) {
          issues.push({ sheet: sheet.name, row: rowNo, message: `无法识别层数「${layerText}」` });
          layer = null;
          continue;
        }
        layer = l;
      }
      const name = text(get("name"));
      const others = (["source", "passage", "density", "medium", "tubes", "depositor", "date"] as const).map((k) => text(get(k)));
      if (!name) {
        if (others.some(Boolean)) issues.push({ sheet: sheet.name, row: rowNo, message: "细胞名称为空但其他列有内容，未导入" });
        continue;
      }
      const rack = col.rack >= 0 ? parseRack(text(get("rack"))) : sheetRack;
      if (rack === null) {
        issues.push({ sheet: sheet.name, row: rowNo, message: "无法确定架号（工作表名应含架号，如「1号架」，或提供「架号」列）" });
        continue;
      }
      if (layer === null) {
        issues.push({ sheet: sheet.name, row: rowNo, message: "无法确定层数" });
        continue;
      }
      const reasons: string[] = [];
      const tubes = parseTubes(get("tubes"));
      if (!tubes.ok) reasons.push(`管数「${tubes.raw}」无法识别`);
      const dateCell = get("date");
      const dateRaw = text(dateCell);
      const frozenOn = parseLooseDate(dateCell);
      if (dateRaw && !frozenOn) reasons.push(`放入时间「${dateRaw}」无法识别`);
      if (name.includes("\n")) reasons.push("名称含多行，可能是多株细胞记在一行");
      out.push({
        rack_no: rack,
        layer_no: layer,
        cell_name: name,
        source: others[0],
        passage: others[1],
        density: others[2],
        freezing_medium: others[3],
        tube_count: tubes.count,
        tube_count_raw: tubes.raw,
        depositor: others[5],
        frozen_on: frozenOn,
        frozen_on_raw: dateRaw,
        needs_review: reasons.length > 0,
        review_reason: reasons.join("；"),
      });
    }
  }
  return { rows: out, issues };
}
