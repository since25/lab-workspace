import { HttpError, str } from "./http";
import { parseLooseDate } from "./imports/sheet";

// 可由用户录入/修改的字段
export const CELL_FIELDS = [
  "rack_no",
  "layer_no",
  "cell_name",
  "source",
  "passage",
  "density",
  "freezing_medium",
  "tube_count",
  "depositor",
  "frozen_on",
  "remarks",
  "needs_review",
] as const;
export type CellField = (typeof CELL_FIELDS)[number];

export const CELL_LABELS: Record<string, string> = {
  rack_no: "架号",
  layer_no: "层",
  cell_name: "细胞名称",
  source: "来源",
  passage: "代次",
  density: "细胞密度",
  freezing_medium: "冻存液",
  tube_count: "管数",
  depositor: "存放人",
  frozen_on: "放入时间",
  remarks: "备注",
  needs_review: "待核对",
};

// 可下拉选择 / 筛选的文本字段：候选值取自台账中已有的值，新填的值保存后自动出现在候选里
export const CELL_OPTION_FIELDS = ["cell_name", "source", "freezing_medium", "depositor"] as const;
// 列表与导出共用的精确筛选参数 → 字段
const EXACT_FILTERS = [["source", "source"], ["depositor", "depositor"], ["medium", "freezing_medium"]] as const;

// 按查询参数拼列表/导出的 WHERE 条件（ids 只用于导出勾选的记录）
export function cellFilter(sp: URLSearchParams): { where: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replaceAll("?", `$${params.length}`));
  };
  if (str(sp.get("rack"))) add("c.rack_no = ?", Number(sp.get("rack")));
  if (str(sp.get("layer"))) add("c.layer_no = ?", Number(sp.get("layer")));
  if (sp.get("review") === "1") where.push("c.needs_review");
  for (const [param, col] of EXACT_FILTERS) {
    if (str(sp.get(param))) add(`c.${col} = ?`, str(sp.get(param)));
  }
  const q = str(sp.get("q"));
  if (q) add("(c.cell_name ILIKE ? OR c.source ILIKE ? OR c.depositor ILIKE ? OR c.remarks ILIKE ?)", `%${q}%`);
  const ids = str(sp.get("ids")).split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length) add("c.id = ANY(?::int[])", ids);
  return { where: where.length ? "WHERE " + where.join(" AND ") : "", params };
}

function int(v: unknown, label: string, min: number, max = Infinity): number {
  const n = Number(str(v));
  if (!str(v) || !Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label}必须是 ${min}${max < Infinity ? `–${max}` : " 以上"}的整数`);
  return n;
}

// 校验用户提交的细胞记录；partial=true 时只校验出现的字段（用于修改）
export function parseCellInput(body: Record<string, unknown>, partial: boolean): Partial<Record<CellField, unknown>> {
  const out: Partial<Record<CellField, unknown>> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  for (const k of CELL_FIELDS) {
    if (partial && !has(k)) continue;
    const v = body[k];
    switch (k) {
      case "rack_no":
        out[k] = int(v, "架号", 1);
        break;
      case "layer_no":
        out[k] = int(v, "层", 1, 10);
        break;
      case "tube_count":
        out[k] = str(v) === "" ? null : int(v, "管数", 0);
        break;
      case "frozen_on": {
        const s = str(v);
        if (s === "") out[k] = null;
        else {
          const d = parseLooseDate(s);
          if (!d) throw new HttpError(400, "放入时间格式不正确，请用 2025-03-07 这样的格式");
          out[k] = d;
        }
        break;
      }
      case "needs_review":
        out[k] = v === true || v === "true";
        break;
      case "cell_name":
        out[k] = str(v);
        if (!out[k]) throw new HttpError(400, "细胞名称不能为空");
        break;
      default:
        out[k] = str(v);
    }
  }
  return out;
}
