import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import type { PoolClient } from "pg";
import type { SessionUser } from "./auth";
import { customTextSheets, decodeCustomText, detectCustomDelimiter, normalizeCustomCell, parseAndSaveCustomCsv, parseCustomImportOptions, prepareCustomImport, readCustomImport, saveCustomImport } from "./label-custom-csv";
import { parseCsv } from "./imports/sheet";

const mocks = vi.hoisted(() => ({ user: vi.fn(), transaction: vi.fn(), query: vi.fn() }));
vi.mock("./auth", () => ({ requireUser: mocks.user }));
vi.mock("./db", () => ({ withTransaction: mocks.transaction, query: mocks.query }));
import { POST } from "../app/api/v1/label-print/custom-batches/route";

const user = { id: 1, role: "member", label_print_enabled: true } as SessionUser;
const client = { query: mocks.query } as unknown as PoolClient;
const parse = (text: string) => prepareCustomImport(customTextSheets(text));
const request = (form: FormData) => new Request("http://localhost/api/v1/label-print/custom-batches", { method: "POST", body: form });
function textForm(text = "数量,名称\n2,样品A") {
  const form = new FormData();
  form.set("text", text);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue(user);
  mocks.transaction.mockImplementation((fn: (db: PoolClient) => Promise<unknown>) => fn(client));
  mocks.query.mockImplementation(async (sql: string, params: unknown[]) => ({ rows: sql.includes("INSERT INTO label_custom_batches")
    ? [{ id: 1, user_id: 1, batch_name: params[1], headers: JSON.parse(params[2] as string), row_count: params[3] }] : [] }));
});

describe("自定义批次解析", () => {
  it("识别 UTF-8 BOM 与 GBK 字节，不产生乱码", () => {
    expect(decodeCustomText(new TextEncoder().encode("\uFEFF名称\n样品A").buffer)).toBe("名称\n样品A");
    expect(decodeCustomText(new Uint8Array([0xc3, 0xfb, 0xb3, 0xc6, 0x2c, 0x41]).buffer)).toBe("名称,A");
  });

  it("识别制表符、分号与逗号，粘贴优先制表符，忽略引号内分隔符", () => {
    for (const delimiter of ["\t", ";", ","]) {
      const source = `名称${delimiter}数量\n样品A${delimiter}2\n样品B${delimiter}3`;
      expect(detectCustomDelimiter(source)).toBe(delimiter);
      expect(parse(source).rows).toEqual([["样品A", "2"], ["样品B", "3"]]);
    }
    expect(detectCustomDelimiter("名称,数量\n样品A,2\n样品B,3\n样品C\t备注,4", true)).toBe("\t");
    expect(detectCustomDelimiter('名称;备注\n样品A;"甲,乙,丙"')).toBe(";");
    expect(parseCsv('名称;备注\n样品A;"甲;乙\n丙"', ";")).toEqual([["名称", "备注"], ["样品A", "甲;乙\n丙"]]);
  });

  it("跳过空行和大标题，按列名优先选择非首列标题", () => {
    const parsed = parse("\n示例登记表\n编号,名称,数量\n示例A,样品A,2\n");
    expect(parsed.preview).toMatchObject({ header_row: 2, title_col: 1, total_rows: 1 });
    expect(parsed.preview.rows_preview).toEqual([["示例A", "样品A", "2"]]);
    expect(parsed.headers).toEqual(["名称", "编号", "数量"]);
    expect(parsed.rows).toEqual([["样品A", "示例A", "2"]]);
    expect(parse("code,title,name,品名,名称\na,b,c,d,e").preview.title_col).toBe(4);
  });

  it("跳过数字、日期行；单列取首个非空行，无法识别时取第零行", () => {
    expect(parse("2026-01-01,2\n名称,数量\n样品A,3").preview.header_row).toBe(1);
    expect(parse("\n\n名称\n样品A").preview.header_row).toBe(2);
    expect(parse("1,2\n3,4").preview.header_row).toBe(0);
    expect(parse("甲,乙\n,样品A").preview.title_col).toBe(1);
  });

  it("按 UTC 日期与有效数字规范化，字符串保留编号前导零", () => {
    const parsed = prepareCustomImport([{ name: "示例", rows: [
      ["名称", "日期", "数值", "启用", "停用", "编号", "空列"],
      [" 样品A ", new Date("2026-01-02T00:00:00Z"), 0.30000000000000004, true, false, " 001 ", null],
    ] }]);
    expect(parsed.rows).toEqual([["样品A", "2026-01-02", "0.3", "是", "否", "001"]]);
    expect(normalizeCustomCell(null)).toBe("");
  });

  it("去掉全空列，空列名补列号，重复列名与已有后缀也不会碰撞", () => {
    const parsed = parse("名称,名称,名称_2,,空列\n样品A,样品B,样品C,备注,\n,,,,");
    expect(parsed.headers).toEqual(["名称", "名称_2", "名称_2_2", "列4"]);
    expect(parsed.preview.columns.map((column) => column.index)).toEqual([0, 1, 2, 3]);
    expect(new Set(parsed.headers).size).toBe(4);
    expect(parsed.preview.total_rows).toBe(1);
  });

  it("覆盖工作表、表头行、标题列、列名和保留列，标题列移动到 headers[0]", () => {
    const parsed = prepareCustomImport([
      { name: "第一表", rows: [["名称"], ["样品A"]] },
      { name: "第二表", rows: [["说明"], ["名称", "数量", "位置"], ["样品B", 2, "示例位置"], ["样品C", null, null]] },
    ], { sheet: "第二表", header_row: 1, title_col: 2, columns: [
      { index: 0, name: "名称", keep: false }, { index: 1, name: "份数", keep: true }, { index: 2, name: "位置", keep: true },
    ] });
    expect(parsed.preview).toMatchObject({ sheets: ["第一表", "第二表"], sheet: "第二表", header_row: 1, title_col: 2, total_rows: 1 });
    expect(parsed.headers).toEqual(["位置", "份数"]);
    expect(parsed.rows).toEqual([["示例位置", "2"]]);
    expect(parsed.preview.columns).toEqual([{ index: 1, name: "份数" }, { index: 2, name: "位置" }]);
  });

  it("预览只含前十行，读取真实 xlsx 多表和日期类型", async () => {
    expect(parse("名称\n" + Array.from({ length: 12 }, (_, i) => `样品${i}`).join("\n")).preview.rows_preview).toHaveLength(10);
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("第一表").addRows([["名称"], ["样品A"]]);
    workbook.addWorksheet("第二表").addRows([["名称", "日期"], ["样品B", new Date("2026-01-02T00:00:00Z")]]);
    const bytes = await workbook.xlsx.writeBuffer();
    const sheets = await readCustomImport(new Uint8Array(bytes).buffer, "示例.xlsx");
    expect(prepareCustomImport(sheets, { sheet: "第二表" }).rows).toEqual([["样品B", "2026-01-02"]]);
  });

  it("拒绝无效选项、越界表头及被排除的标题列", () => {
    for (const value of [null, [], { title_col: -1 }, { header_row: "1" }, { columns: [{}] }]) {
      expect(() => parseCustomImportOptions(value)).toThrow();
    }
    expect(() => prepareCustomImport(customTextSheets("名称\n样品A"), { header_row: 5 })).toThrow("超出");
    expect(() => prepareCustomImport(customTextSheets("名称\n样品A"), { title_col: 0, columns: [{ index: 0, name: "名称", keep: false }] })).toThrow("标题列");
  });
});

describe("自定义批次保存与接口（模拟数据库）", () => {
  it("旧 JSON 仍直接保存并返回 201，标题列移到第一位", async () => {
    const response = await POST(new Request("http://localhost/api/v1/label-print/custom-batches", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch_name: "示例批次", csv_text: "数量,名称\n2,样品A" }),
    }));
    expect(response.status).toBe(201);
    expect((await response.json()).batch).toMatchObject({ batch_name: "示例批次", headers: ["名称", "数量"], row_count: 1 });
    expect(mocks.query.mock.calls[1][1]).toEqual([1, 1, "样品A", JSON.stringify({ 名称: "样品A", 数量: "2" }), 1]);
  });

  it("默认预览不进入事务、不写库，空文件不妨碍粘贴文本", async () => {
    const form = textForm();
    form.set("file", new File([], ""));
    const response = await POST(request(form));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ title_col: 1, total_rows: 1 });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("multipart commit 按最终配置写入标题、改名和筛选后的字段", async () => {
    const form = textForm("数量,名称,备注\n2,样品A,示例备注");
    form.set("mode", "commit");
    form.set("batch_name", "示例批次");
    form.set("options", JSON.stringify({ title_col: 0, columns: [
      { index: 0, name: "份数", keep: true }, { index: 1, name: "样品", keep: true }, { index: 2, name: "备注", keep: false },
    ] }));
    const response = await POST(request(form));
    expect(response.status).toBe(201);
    expect((await response.json()).batch.headers).toEqual(["份数", "样品"]);
    expect(mocks.query.mock.calls[1][1]).toEqual([1, 1, "2", JSON.stringify({ 份数: "2", 样品: "样品A" }), 1]);
  });

  it("文件上传自动解码 GBK，并支持 tsv / txt", async () => {
    const gbk = new Uint8Array([0xc3, 0xfb, 0xb3, 0xc6, 0x2c, 0x41, 0x0a, 0x42, 0x2c, 0x31]);
    for (const [name, bytes] of [["示例.csv", gbk], ["示例.tsv", "名称\t数量\n样品A\t2"], ["示例.txt", "名称;数量\n样品A;2"]] as const) {
      const form = new FormData();
      form.set("file", new File([bytes], name));
      const response = await POST(request(form));
      expect(response.status).toBe(200);
      expect((await response.json()).columns[0].name).toBe("名称");
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("跳过空行，空标题补名；500 行允许，501 行拒绝且不写入", async () => {
    await parseAndSaveCustomCsv(client, user, "示例批次", "名称,数量\n样品A,1\n,2\n,\n");
    expect(mocks.query.mock.calls[2][1]).toEqual([1, 1, "样本-2", JSON.stringify({ 名称: "", 数量: "2" }), 2]);
    mocks.query.mockClear();
    const text = "名称\n" + Array.from({ length: 500 }, (_, index) => `样品${index}`).join("\n");
    await expect(saveCustomImport(client, user, "示例批次", parse(text))).resolves.toMatchObject({ row_count: 500 });
    expect(mocks.query).toHaveBeenCalledTimes(501);
    mocks.query.mockClear();
    await expect(parseAndSaveCustomCsv(client, user, "示例批次", text + "\n样品A")).rejects.toThrow("500");
    await expect(parseAndSaveCustomCsv(client, user, "示例批次", "名称\n")).rejects.toThrow();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("文件与文本二选一，拒绝无效模式、选项、格式与超大文件", async () => {
    const both = textForm();
    both.set("file", new File(["名称\n样品A"], "示例.csv"));
    const badMode = textForm(); badMode.set("mode", "错误");
    const badOptions = textForm(); badOptions.set("options", "{");
    const badFile = new FormData(); badFile.set("file", new File(["示例"], "示例.pdf"));
    for (const form of [both, badMode, badOptions, badFile, new FormData()]) {
      expect((await POST(request(form))).status).toBe(400);
    }
    const oversized = new FormData();
    oversized.set("file", new File([new Uint8Array(20 * 1024 * 1024 + 1)], "示例.csv"));
    expect((await POST(request(oversized))).status).toBe(413);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
