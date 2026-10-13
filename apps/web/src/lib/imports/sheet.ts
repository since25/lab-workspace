import ExcelJS from "exceljs";

export type Cell = string | number | boolean | Date | null;

// 读取工作簿：xlsx 用 exceljs（WPS 导出的文件 SheetJS 会错位读取共享字符串），csv 自行解析。
// 合并单元格的值会填入合并区域内每一格（如跨两行的「一」层）。
export async function readWorkbook(buf: ArrayBuffer, filename: string): Promise<{ name: string; rows: Cell[][] }[]> {
  if (filename.toLowerCase().endsWith(".csv")) {
    return [{ name: filename.replace(/\.csv$/i, ""), rows: parseCsv(new TextDecoder("utf-8").decode(buf).replace(/^\uFEFF/, "")) }];
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
  } catch {
    throw new Error("无法读取该文件，请确认是 .xlsx 或 .csv 格式");
  }
  const out: { name: string; rows: Cell[][] }[] = [];
  wb.eachSheet((ws) => {
    const width = ws.columnCount;
    const rows: Cell[][] = [];
    for (let i = 1; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const arr: Cell[] = [];
      for (let j = 1; j <= width; j++) arr.push(cellValue(row.getCell(j).value));
      rows.push(arr);
    }
    out.push({ name: ws.name, rows });
  });
  return out;
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text);
  }
  return null;
}

// 简单 CSV 解析：支持双引号转义和字段内换行
export function parseCsv(src: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field === "" ? null : field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field === "" ? null : field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field === "" ? null : field);
    rows.push(row);
  }
  return rows;
}

export function text(v: Cell | undefined): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isoDate(v);
  return String(v).trim();
}

// exceljs 的日期是 UTC 零点，按 UTC 分量输出，避免服务器时区把日期推前一天
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return isoDate(dt);
}

// 宽松解析日期：Date、Excel 序列号、20250307、2025-03-07 / 2025/3/7 / 2025.3.7
// 返回 null 表示无法可靠识别
export function parseLooseDate(v: Cell | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : isoDate(v);
  if (typeof v === "number") {
    if (Number.isInteger(v) && v >= 19900101 && v <= 21001231) {
      return validYmd(Math.floor(v / 10000), Math.floor((v % 10000) / 100), v % 100);
    }
    if (v > 25000 && v < 75000) {
      // Excel 1900 日期系统序列号
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400_000);
      return validYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  return null;
}

export function parseNumber(v: Cell | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).trim().replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}
