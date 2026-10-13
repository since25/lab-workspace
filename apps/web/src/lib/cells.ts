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
