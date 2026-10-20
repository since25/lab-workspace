import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { assetDepartments, type AssetRow, parseAssetWorkbook } from "./imports/assets";
import { assetDisplayDepartments, assetMeta, assetView, listAssetGroupItems, listAssetGroups, listAssetItems } from "./assets-list";
import type { AssetQuery } from "./assets-list";

// 部门、人员、资产与编号均为虚构；数据库只在进程内存在。
const db = new PGlite();
const query: AssetQuery = async <T>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params)).rows;
const research = "示例研发部";
const analysis = "示例分析平台";
const deptScope = [research];

const asset = (changes: Partial<AssetRow> = {}): AssetRow => ({
  asset_code: "ZX-EXAMPLE-1", asset_code_new: "CMC-EXAMPLE-1", asset_name: "示例移液器", spec_model: "EXAMPLE-P1",
  category: "示例器具", quantity: 1, location: "示例203", department: research, user_name: "示例成员甲", ...changes,
});
const seed = (rows: AssetRow[]) =>
  db.query(
    `INSERT INTO fixed_assets(asset_code, asset_code_new, asset_name, spec_model, category, quantity, location, department, user_name)
     VALUES ${rows.map((_, i) => `($${i * 9 + 1},$${i * 9 + 2},$${i * 9 + 3},$${i * 9 + 4},$${i * 9 + 5},$${i * 9 + 6},$${i * 9 + 7},$${i * 9 + 8},$${i * 9 + 9})`).join(",")}`,
    rows.flatMap((r) => [r.asset_code, r.asset_code_new, r.asset_name, r.spec_model, r.category, r.quantity, r.location, r.department, r.user_name])
  );

beforeAll(async () => {
  await db.exec(await readFile(new URL("../../../../db/migrations/001_init.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../../db/migrations/002_fixed_assets.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../../db/migrations/010_asset_codes.sql", import.meta.url), "utf8"));
}, 30000);
beforeEach(async () => { await db.exec("TRUNCATE fixed_assets, import_batches RESTART IDENTITY CASCADE"); });
afterAll(() => db.close());

describe("固定资产台账全量解析", () => {
  const sheet = (name: string, rows: (string | null)[][]) => ({ name, rows });
  const header = ["序号", "固定资产编号", "固定资产新编号（2023.7月起）", "固定资产名称", "规格型号", "类别名称", "数量", "存放地点", "使用部门", "使用人"];

  it("保留两套资产编号并导入所有部门，不再只留研发部", () => {
    const { rows, issues, fatal } = parseAssetWorkbook([
      sheet("示例正式表", [
        header,
        ["1", "ZX-EXAMPLE-1", "CMC-EXAMPLE-1", "示例移液器", "EXAMPLE-P1", "示例器具", "1", "示例203", research, "示例成员甲"],
        ["2", "ZX-EXAMPLE-2", "", "示例移液器", "EXAMPLE-P1", "示例器具", "1", "示例205", research, "示例成员乙"],
        ["3", "ZX-EXAMPLE-3", "CMC-EXAMPLE-3", "示例离心机", "EXAMPLE-C1", "示例设备", "1", "示例209", analysis, "示例成员丙"],
      ]),
    ]);
    expect(fatal).toBeNull();
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ asset_code: "ZX-EXAMPLE-1", asset_code_new: "CMC-EXAMPLE-1", department: research });
    expect(rows[1]).toMatchObject({ asset_code: "ZX-EXAMPLE-2", asset_code_new: "" });
    expect(rows[2].department).toBe(analysis);
    expect(assetDepartments(rows)).toEqual([{ department: research, rows: 2 }, { department: analysis, rows: 1 }]);
  });

  it("跳过表中重复出现的表头行、合计行与缺少使用部门的行并逐行提示", () => {
    const { rows, issues } = parseAssetWorkbook([
      sheet("示例正式表", [
        header,
        ["1", "ZX-EXAMPLE-1", "CMC-EXAMPLE-1", "示例移液器", "EXAMPLE-P1", "示例器具", "1", "示例203", research, "示例成员甲"],
        ["更改后固定资产编号", "更改后固定资产编号(20211102)", "固定资产名称", "规格型号", "类别名称", "数量", "存放地点", "使用部门", "使用人", "备注"],
        ["2", "ZX-EXAMPLE-2", "CMC-EXAMPLE-2", "示例装修", "", "示例装修", "1", "示例NA", "", ""],
        ["", "合计", "", "", "", "", "", "", "", ""],
      ]),
    ]);
    expect(rows).toHaveLength(1);
    expect(issues.map((i) => i.row)).toEqual([3, 4]);
    expect(issues[0].message).toContain("表头行");
    expect(issues[1].message).toContain("缺少使用部门");
  });

  it("没有固定资产编号的工作表用「更改后固定资产编号」兜底，跨表同编号只导入一次", () => {
    const { rows, issues } = parseAssetWorkbook([
      sheet("示例正式表", [
        header,
        ["1", "ZX-EXAMPLE-1", "CMC-EXAMPLE-1", "示例移液器", "EXAMPLE-P1", "示例器具", "1", "示例203", research, "示例成员甲"],
      ]),
      sheet("示例未入账", [
        ["序号", "更改后固定资产编号(20211102)", "固定资产名称", "规格型号", "类别名称", "数量", "存放地点", "使用部门", "使用人"],
        ["2", "ZX-EXAMPLE-9", "示例标签打印机", "EXAMPLE-L1", "示例器具", "1", "示例203", research, "示例成员乙"],
        ["3", "ZX-EXAMPLE-1", "示例移液器", "EXAMPLE-P1", "示例器具", "1", "示例203", research, "示例成员甲"],
      ]),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1].asset_code).toBe("ZX-EXAMPLE-9");
    expect(issues.map((i) => i.message)).toEqual(["资产编号 ZX-EXAMPLE-1 已在前面导入，跳过"]);
  });

  it("SheetN 草稿表不读；没有任何可用工作表时给出明确提示", () => {
    expect(parseAssetWorkbook([sheet("Sheet1", [header, ["1", "ZX-EXAMPLE-1", "", "示例移液器", "", "", "1", "", research, ""]])]).rows).toHaveLength(0);
    expect(parseAssetWorkbook([sheet("示例空白", [["说明"]])]).fatal).toContain("没有找到包含");
  });
});

describe("展示范围配置", () => {
  it("未配置时只展示研发部；可配置多个部门；配置 * 表示不限部门；配置无效时报错而不是放行", () => {
    expect(assetDisplayDepartments(undefined)).toEqual(["研发部"]);
    expect(assetDisplayDepartments('["示例研发部"," 示例分析平台 "]')).toEqual([research, analysis]);
    expect(assetDisplayDepartments('["*"]')).toEqual([]);
    expect(() => assetDisplayDepartments("broken")).toThrow("固定资产展示部门配置无效");
    expect(() => assetDisplayDepartments('[""]')).toThrow();
    expect(assetView(new URLSearchParams(""))).toBe("group");
    expect(assetView(new URLSearchParams("view=item"))).toBe("item");
    expect(assetView(new URLSearchParams("view=detail"))).toBe("detail");
    expect(assetView(new URLSearchParams("view=other"))).toBe("group");
  });
});

describe("汇总视图与明细视图", () => {
  beforeEach(async () => {
    await seed([
      // 同名同规格、两个存放地点、两个使用人
      asset({ asset_code: "ZX-EXAMPLE-1", asset_code_new: "CMC-EXAMPLE-1", location: "示例203", user_name: "示例成员甲" }),
      asset({ asset_code: "ZX-EXAMPLE-2", asset_code_new: "CMC-EXAMPLE-2", location: "示例203", user_name: "示例成员乙" }),
      asset({ asset_code: "ZX-EXAMPLE-3", asset_code_new: "CMC-EXAMPLE-3", location: "示例205", user_name: "示例成员甲" }),
      // 同名同规格但另一个部门，属于另一个分组
      asset({ asset_code: "ZX-EXAMPLE-4", asset_code_new: "CMC-EXAMPLE-4", location: "示例209", department: analysis, user_name: "示例成员丙" }),
      // 另一个物品，没有规格型号
      asset({ asset_code: "ZX-EXAMPLE-5", asset_code_new: "", asset_name: "示例电脑", spec_model: "", category: "示例办公设备", location: "示例207" }),
      // 展示范围之外的部门
      asset({ asset_code: "ZX-EXAMPLE-6", asset_code_new: "CMC-EXAMPLE-6", asset_name: "示例其他资产", location: "示例211", department: "示例行政部" }),
    ]);
  });

  it("汇总按名称＋规格型号＋使用部门分组，地点条数与明细一致，展示范围外部门不计入", async () => {
    const g = await listAssetGroups(query, new URLSearchParams(), deptScope);
    expect(g.total).toBe(2);
    expect(g.page_size).toBe(100);
    expect(g.departments).toEqual(deptScope);
    const pipette = g.groups.find((x) => x.asset_name === "示例移液器")!;
    expect(pipette).toMatchObject({ spec_model: "EXAMPLE-P1", department: research, item_count: 3, location_count: 2 });
    expect(pipette.locations).toEqual([
      { location: "示例203", item_count: 2, total_quantity: "2" },
      { location: "示例205", item_count: 1, total_quantity: "1" },
    ]);
    const names = pipette.user_names?.split("、") ?? [];
    expect(names).toHaveLength(2);
    expect(names).toContain("示例成员甲");
    expect(names).toContain("示例成员乙");
    const g2 = await listAssetGroups(query, new URLSearchParams(), [research, analysis]);
    expect(g2.total).toBe(3);
    expect(g2.groups.map((x) => x.department)).toContain(analysis);
    const all = await listAssetGroups(query, new URLSearchParams(), []);
    expect(all.total).toBe(4);
    // 明细视图：研发部 4 条（移液器 3 条＋电脑 1 条）
    expect((await listAssetItems(query, new URLSearchParams(), deptScope)).total).toBe(4);
  });

  it("关键词同时匹配两套资产编号，地点与部门筛选在汇总、明细和展开之间保持一致", async () => {
    expect((await listAssetGroups(query, new URLSearchParams("q=CMC-EXAMPLE-4"), [research, analysis])).total).toBe(1);
    expect((await listAssetGroups(query, new URLSearchParams("q=ZX-EXAMPLE-5"), deptScope)).total).toBe(1);
    expect((await listAssetGroups(query, new URLSearchParams("q=不存在"), deptScope)).total).toBe(0);
    const byLoc = await listAssetGroups(query, new URLSearchParams("location=示例203"), deptScope);
    expect(byLoc.total).toBe(1);
    expect(byLoc.groups[0].locations).toEqual([{ location: "示例203", item_count: 2, total_quantity: "2" }]);
    const byDept = await listAssetGroups(query, new URLSearchParams("department=示例分析平台"), [research, analysis]);
    expect(byDept.total).toBe(1);
    // 范围之外的部门即使用参数指定也不放行
    expect((await listAssetGroups(query, new URLSearchParams("department=示例行政部"), deptScope)).total).toBe(2);
    // 展开某个分组：同一套筛选下只返回该分组、该地点的明细
    const detail = await listAssetGroupItems(query, new URLSearchParams("location=示例203&name=示例移液器&spec=EXAMPLE-P1&group_department=" + research), deptScope);
    expect(detail.items).toHaveLength(2);
    expect(detail.items.map((i) => i.asset_code)).toEqual(["ZX-EXAMPLE-1", "ZX-EXAMPLE-2"]);
    expect((await listAssetGroupItems(query, new URLSearchParams("name=示例移液器&spec=EXAMPLE-P1&group_department=" + analysis), deptScope)).items).toHaveLength(0);
  });

  it("排序、分页与页数收敛，超出范围的页码回到第一页", async () => {
    const byCount = await listAssetGroups(query, new URLSearchParams("sort=item_count&dir=desc"), deptScope);
    expect(byCount.groups[0].asset_name).toBe("示例移液器");
    const byName = await listAssetGroups(query, new URLSearchParams("sort=asset_name&dir=asc"), deptScope);
    expect(byName.groups.map((g) => g.asset_name)).toEqual(["示例电脑", "示例移液器"]);
    expect((await listAssetItems(query, new URLSearchParams("page=999"), deptScope)).page).toBe(1);
    expect((await listAssetGroups(query, new URLSearchParams("page=999"), deptScope)).page).toBe(1);
    // 白名单之外的排序字段退回默认排序，不会拼进 SQL
    const injected = await listAssetGroups(query, new URLSearchParams("sort=item_count);DROP TABLE fixed_assets;--"), deptScope);
    expect(injected.total).toBe(2);
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM fixed_assets")).rows[0].n).toBe(6);
  });

  it("候选只覆盖展示范围内的部门，最近导入批次随列表返回", async () => {
    await db.query(
      `INSERT INTO import_batches(dataset_type, filename, row_count, accepted_count, status) VALUES ('assets','示例台账.xlsx',6,6,'committed')`
    );
    const meta = await assetMeta(query, deptScope);
    // 展示范围内只有研发部，其他部门不会出现在候选里
    expect(meta.facets.department).toEqual([research]);
    expect(meta.facets.location).toEqual(["示例203", "示例205", "示例207"]);
    expect(meta.facets.category).toEqual(["示例办公设备", "示例器具"]);
    expect(meta.last_import).toMatchObject({ filename: "示例台账.xlsx", accepted_count: 6 });
    // 整表替换覆盖所有部门，所以这里给的是全量条数而不是展示范围内的 4 条
    expect(meta.total_rows).toBe(6);
    const all = await assetMeta(query, []);
    expect(all.facets.department).toContain("示例行政部");
  });
});
