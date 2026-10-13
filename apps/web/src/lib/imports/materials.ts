import { type Cell, parseLooseDate, parseNumber, text } from "./sheet";
import type { ImportIssue } from "./cells";

export interface MaterialRow {
  requested_on: string | null;
  requester: string;
  department: string;
  request_no: string;
  material_code: string;
  status: string;
  major_category: string;
  minor_category: string;
  item_name: string;
  brand: string;
  spec_model: string;
  unit: string;
  quantity: number | null;
  is_urgent: boolean;
  project_code: string;
  remarks: string;
  order_no: string;
  purchased_qty: number | null;
  last_received_on: string | null;
  received_qty: number | null;
  receipt_status: string;
}

// 采购系统「请购物料库」导出的列名 → 字段
const HEADERS: Record<string, keyof MaterialRow> = {
  请购日期: "requested_on",
  请购人: "requester",
  任职部门: "department",
  采购单编码: "request_no",
  物料编码: "material_code",
  状态: "status",
  请购大类: "major_category",
  请购小类: "minor_category",
  名称: "item_name",
  品牌: "brand",
  规格型号: "spec_model",
  单位: "unit",
  数量: "quantity",
  是否紧急: "is_urgent",
  使用项目: "project_code",
  备注: "remarks",
  合同或订单编号: "order_no",
  采购数量: "purchased_qty",
  最近收货日期: "last_received_on",
  收货数量: "received_qty",
  收货状态: "receipt_status",
};
const REQUIRED = ["物料编码", "名称", "请购日期"];

export function parseMaterialWorkbook(sheets: { name: string; rows: Cell[][] }[]): {
  rows: MaterialRow[];
  issues: ImportIssue[];
  fatal: string | null;
} {
  const sheet = sheets[0];
  if (!sheet) return { rows: [], issues: [], fatal: "文件里没有工作表" };
  let hi = -1;
  for (let i = 0; i < Math.min(sheet.rows.length, 10); i++) {
    if (sheet.rows[i].map((c) => text(c)).includes("物料编码")) {
      hi = i;
      break;
    }
  }
  if (hi < 0) return { rows: [], issues: [], fatal: "前 10 行里找不到包含「物料编码」的表头，请确认是采购系统「请购物料库」的导出文件" };
  const header = sheet.rows[hi].map((c) => text(c));
  const missing = REQUIRED.filter((h) => !header.includes(h));
  if (missing.length) return { rows: [], issues: [], fatal: `缺少必需列：${missing.join("、")}` };

  const rows: MaterialRow[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();
  for (let i = hi + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    if (r.every((c) => text(c) === "")) continue;
    const rec: Partial<Record<keyof MaterialRow, Cell>> = {};
    header.forEach((h, j) => {
      const k = HEADERS[h];
      if (k) rec[k] = r[j];
    });
    const rowNo = i + 1;
    const code = text(rec.material_code);
    if (!code) {
      issues.push({ sheet: sheet.name, row: rowNo, message: "物料编码为空，未导入" });
      continue;
    }
    if (seen.has(code)) {
      issues.push({ sheet: sheet.name, row: rowNo, message: `物料编码 ${code} 重复，只保留第一条` });
      continue;
    }
    seen.add(code);
    rows.push({
      requested_on: parseLooseDate(rec.requested_on ?? null),
      requester: text(rec.requester),
      department: text(rec.department),
      request_no: text(rec.request_no),
      material_code: code,
      status: text(rec.status),
      major_category: text(rec.major_category),
      minor_category: text(rec.minor_category),
      item_name: text(rec.item_name),
      brand: text(rec.brand),
      spec_model: text(rec.spec_model),
      unit: text(rec.unit),
      quantity: parseNumber(rec.quantity),
      is_urgent: text(rec.is_urgent) === "勾选" || text(rec.is_urgent) === "是",
      project_code: text(rec.project_code),
      remarks: text(rec.remarks),
      order_no: text(rec.order_no),
      purchased_qty: parseNumber(rec.purchased_qty),
      last_received_on: parseLooseDate(rec.last_received_on ?? null),
      received_qty: parseNumber(rec.received_qty),
      receipt_status: text(rec.receipt_status),
    });
  }
  return { rows, issues, fatal: null };
}
