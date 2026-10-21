import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import { MaterialError } from "./materials-data";
import type { MaterialQuery } from "./materials-list";
import {
  classifyConsumable, normalizeStockText, stockCategories, stockGroups, stockStale, stockStatus,
  STOCK_STALE_DAYS,
} from "./consumables";
import {
  checkStock, createStockItem, deleteStockItem, listChecks, listStock, syncStockCandidates, updateStockItem,
} from "./consumable-stock";

// 全部名称和数量均为虚构；数据库只在进程内存在。
const db = new PGlite();
const admin = { id: 1 };
const member = { id: 2 };
const query: MaterialQuery = async <T,>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params)).rows;
const transaction = <T>(fn: (c: PoolClient) => Promise<T>) => db.transaction((c) => fn(c as unknown as PoolClient));

const builtin = stockCategories("");
const create = (changes: Record<string, unknown> = {}) => transaction((c) => createStockItem(c, {
  category: "塑料耗材/吸头", item_name: "示例 200ul 吸头", brand: "示例品牌", spec_model: "EXAMPLE-TIP", unit: "盒",
  quantity: 10, note: "示例备注", ...changes,
}, admin, builtin));

beforeAll(async () => {
  await db.exec(await readFile(new URL("../../../../db/migrations/001_init.sql", import.meta.url), "utf8"));
  await db.exec("INSERT INTO material_items(request_no, material_code, item_name) VALUES ('EXAMPLE-LEGACY','EXAMPLE-LEGACY','示例历史记录')");
  await db.exec(await readFile(new URL("../../../../db/migrations/009_material_usage.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../../db/migrations/011_consumable_stock.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../../db/migrations/012_stock_reconcile.sql", import.meta.url), "utf8"));
  await db.exec("INSERT INTO users(id,username,display_name,password_hash,role) VALUES (1,'example-admin','示例管理员','example-hash','admin'),(2,'example-member','示例成员','example-hash','member')");
}, 30000);
beforeEach(async () => {
  await db.exec("TRUNCATE consumable_stock, consumable_stock_checks, material_items, audit_logs RESTART IDENTITY CASCADE");
});
afterAll(() => db.close());

describe("类别配置与分类", () => {
  it("默认类别为四大类 + 其他，大类下共 20 个子类，名称唯一", () => {
    expect(stockGroups(builtin)).toEqual(["普通用品", "塑料耗材", "生物试剂", "试剂盒", "其他"]);
    expect(builtin.filter((c) => c.name.includes("/"))).toHaveLength(20);
    expect(new Set(builtin.map((c) => c.name)).size).toBe(builtin.length);
  });
  it("配置支持只写名称（沿用内置关键词）和自定义关键词，标签卡随配置的大类变化", () => {
    const names = stockCategories('[" 塑料耗材/吸头 ","示例类别"]');
    expect(names.map((c) => c.name)).toEqual(["塑料耗材/吸头", "示例类别"]);
    expect(stockGroups(names)).toEqual(["塑料耗材", "示例类别"]);
    expect(names[0].keywords).toContain("吸头");
    expect(names[1].keywords).toEqual([]);
    const custom = stockCategories('[{"name":"耗材甲","keywords":[" 特别耗材 ","EXAMPLE"]}]');
    expect(custom[0].keywords).toEqual(["特别耗材", "example"]);
    expect(classifyConsumable("特别耗材 500ml", custom)).toBe("耗材甲");
  });
  it("配置为空、重复、类型错误或坏 JSON 时按配置错误处理", () => {
    for (const raw of ["[]", "broken", '["吸头","吸头"]', '[{"name":""}]', '[{"name":"甲","keywords":"x"}]', '[{"name":"甲","keywords":[""]}]']) {
      expect(() => stockCategories(raw)).toThrow(MaterialError);
    }
  });
  it("中英文关键词都能把高频品归到对应子类", () => {
    const cases: [string, string][] = [
      ["200ul 滤芯吸头", "塑料耗材/吸头"], ["10ul filter tips", "塑料耗材/吸头"], ["Combitips advanced 5ml", "塑料耗材/吸头"],
      ["T25 细胞培养瓶", "塑料耗材/培养板皿"], ["6 孔板", "塑料耗材/培养板皿"], ["24 well plate", "塑料耗材/培养板皿"],
      ["96孔半裙边PCR板", "塑料耗材/PCR板连管封膜"], ["透明8联PCR管 平盖", "塑料耗材/PCR板连管封膜"], ["封膜，普通型，适用于96孔板", "塑料耗材/PCR板连管封膜"],
      ["10mL 移液管", "塑料耗材/移液管"], ["1.5mL EP管", "塑料耗材/离心管冻存管"], ["2ml Cryovial", "塑料耗材/离心管冻存管"],
      ["MP 裂解介质管", "塑料耗材/研磨管电转耗材"], ["Nucleocuvette Strip", "塑料耗材/研磨管电转耗材"],
      ["70μm 细胞筛 cell strainer", "塑料耗材/滤器"], ["血清瓶 500ml", "塑料耗材/瓶槽盒架"],
      ["DMEM 高糖培养基", "生物试剂/培养基"], ["RPMI 1640 培养基、GlutaMAX™ 补充剂、HEPES", "生物试剂/培养基"], ["IMDM，GlutaMAX™ 添加剂", "生物试剂/培养基"], ["Opti-MEM I", "生物试剂/培养基"], ["MethoCult H4434", "生物试剂/培养基"],
      ["PENICILLIN STREPTOMYCIN SOL", "生物试剂/添加物消化"], ["0.9% 生理盐水", "生物试剂/添加物消化"], ["TrypLE / Trypsin-EDTA", "生物试剂/添加物消化"],
      ["Lipofectamine MessengerMAX", "生物试剂/转染"], ["jetPRIME 转染试剂", "生物试剂/转染"],
      ["QuickExtract DNA Extraction Solution", "试剂盒/核酸提取纯化"], ["FastPure Gel DNA", "试剂盒/核酸提取纯化"],
      ["DH5α 感受态细胞", "试剂盒/分子克隆PCR"], ["2× Phanta Max Master Mix", "试剂盒/分子克隆PCR"],
      ["HiScript II One Step", "试剂盒/逆转录RNA"], ["Human IL-6 ELISA Kit", "试剂盒/检测试剂盒"], ["人 alpha 1 Antitrypsin ELISA试剂盒", "试剂盒/检测试剂盒"],
      ["24孔 TC 泡壳装", "塑料耗材/培养板皿"], ["LONZA 电转 96孔套装", "塑料耗材/研磨管电转耗材"], ["30kd 超滤管", "塑料耗材/滤器"], ["75%乙醇 5L", "普通用品/纸品清洁"], ["GelRed 核酸染料", "试剂盒/核酸染料"],
      ["丁腈手套 M", "普通用品/手套"], ["一次性鞋套", "普通用品/口罩帽鞋套"], ["擦手纸", "普通用品/纸品清洁"], ["低温标签", "普通用品/标签打印"],
    ];
    for (const [text, category] of cases) expect([text, classifyConsumable(text, builtin)]).toEqual([text, category]);
    expect(normalizeStockText(" ＤＭＥＭ  高糖 ")).toBe("dmem高糖");
  });
  it("一次性长尾（抗体、原代细胞、耳标、饲料、脂质原料）不归类", () => {
    for (const text of ["兔抗人 CD3 抗体", "APC-Labeled Monoclonal Antibody", "人原代 T 细胞", "小鼠耳标", "繁殖饲料", "胆固醇", "DSPC 脂质"]) {
      expect([text, classifyConsumable(text, builtin)]).toEqual([text, null]);
    }
  });
  it("库存状态三态：数量 0 为已用完，从未核对或超过期限为需复核，其余正常", () => {
    const now = new Date("2026-10-20T00:00:00Z").getTime();
    const old = new Date(now - (STOCK_STALE_DAYS + 1) * 86400000).toISOString();
    expect(stockStatus({ quantity: 0, last_checked_at: null }, now)).toBe("stale");
    expect(stockStatus({ quantity: 5, last_checked_at: null }, now)).toBe("stale");
    expect(stockStatus({ quantity: 0, last_checked_at: "2026-10-19T00:00:00Z" }, now)).toBe("out");
    expect(stockStatus({ quantity: 0, last_checked_at: old }, now)).toBe("out");
    expect(stockStatus({ quantity: 2, last_checked_at: old }, now)).toBe("stale");
    expect(stockStatus({ quantity: 2, last_checked_at: "2026-10-01T00:00:00Z" }, now)).toBe("ok");
    expect(stockStale({ quantity: 4, last_checked_at: null }, now)).toBe(true);
    expect(stockStale({ quantity: 4, last_checked_at: "2026-10-01T00:00:00Z" }, now)).toBe(false);
    expect(stockStale({ quantity: 4, last_checked_at: old }, now)).toBe(true);
  });
});

describe("库存条目与核对台账", () => {
  it("迁移建表后采购记录照常保存；新建带初始数量的条目会写一条建立库存记录", async () => {
    await db.query("INSERT INTO material_items(request_no, material_code, item_name) VALUES ('EXAMPLE-LEGACY','EXAMPLE-LEGACY','示例历史记录')");
    const item = await create();
    expect((await db.query("SELECT item_name FROM material_items WHERE request_no='EXAMPLE-LEGACY'")).rows).toHaveLength(1);
    expect(item).toMatchObject({ category: "塑料耗材/吸头", quantity: 10, status: "ok", revision: 0, checked_by_name: "示例管理员" });
    expect(item).not.toHaveProperty("safety_stock");
    const checks = await listChecks(query, item.id);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ before_qty: 0, after_qty: 10, note: "建立库存", checked_by_name: "示例管理员" });
    expect((await db.query("SELECT action FROM audit_logs")).rows).toEqual([{ action: "material_stock.create" }]);
  });
  it("不填初始数量时条目标为需复核（不当作已用完），不生成核对记录", async () => {
    const item = await create({ quantity: undefined });
    expect(item).toMatchObject({ status: "stale", last_checked_at: null, quantity: 0 });
    expect(await listChecks(query, item.id)).toHaveLength(0);
  });
  it("同名同品牌同规格拒绝重复；非法类别、空名称和负数被拒绝", async () => {
    await create();
    await expect(create()).rejects.toMatchObject({ status: 409 });
    await expect(create({ category: "不存在的类别" })).rejects.toThrow("耗材类别");
    await expect(create({ item_name: "  " })).rejects.toThrow("名称");
    await expect(create({ quantity: -1 })).rejects.toThrow("0 至 10 亿");
    // 旧客户端仍带 safety_stock 时忽略，不报错也不写入。
    const legacy = await create({ item_name: "示例旧客户端", safety_stock: "abc" });
    expect(legacy).toMatchObject({ item_name: "示例旧客户端", status: "ok" });
  });
  it("核对覆盖数量并保留改前/改后，旧 revision 再提交会被拒绝且不覆盖", async () => {
    const item = await create();
    const checked = await transaction((c) => checkStock(c, item.id, { quantity: 3, note: "用掉 7 盒", expected_revision: item.revision }, member));
    expect(checked).toMatchObject({ quantity: 3, status: "ok", revision: 1 });
    expect((await listChecks(query, item.id)).map((r) => [r.before_qty, r.after_qty, r.note])).toEqual([[10, 3, "用掉 7 盒"], [0, 10, "建立库存"]]);
    await expect(transaction((c) => checkStock(c, item.id, { quantity: 1, expected_revision: item.revision }, member)))
      .rejects.toMatchObject({ status: 409 });
    const [row] = (await db.query<{ quantity: string }>("SELECT quantity FROM consumable_stock WHERE id=$1", [item.id])).rows;
    expect(Number(row.quantity)).toBe(3);
    await expect(transaction((c) => checkStock(c, item.id, { quantity: -2 }, admin))).rejects.toThrow("0 至 10 亿");
    await expect(transaction((c) => checkStock(c, 999, { quantity: 1 }, admin))).rejects.toMatchObject({ status: 404 });
  });
  it("编辑只改基础信息，安全库存字段被忽略，数量必须走核对；改重名时冲突", async () => {
    const first = await create();
    const second = await create({ item_name: "示例 10ul 吸头", spec_model: "EXAMPLE-TIP-10" });
    await db.query("UPDATE consumable_stock SET safety_stock = 5 WHERE id = $1", [first.id]);
    const updated = await transaction((c) => updateStockItem(c, first.id, { safety_stock: 8, note: "新备注", unit: "箱" }, admin, builtin));
    expect(updated).toMatchObject({ note: "新备注", unit: "箱", revision: 1 });
    // 老数据的 safety_stock 列保留原值，不被改写，读取也不报错。
    expect(Number((await db.query<{ safety_stock: string }>("SELECT safety_stock FROM consumable_stock WHERE id=$1", [first.id])).rows[0].safety_stock)).toBe(5);
    await expect(transaction((c) => updateStockItem(c, first.id, { safety_stock: 3 }, admin, builtin))).rejects.toThrow("没有需要修改");
    await expect(transaction((c) => updateStockItem(c, first.id, { quantity: 9 }, admin, builtin))).rejects.toThrow("核对");
    await expect(transaction((c) => updateStockItem(c, first.id, { item_name: second.item_name, spec_model: second.spec_model }, admin, builtin)))
      .rejects.toMatchObject({ status: 409 });
    await expect(transaction((c) => updateStockItem(c, first.id, {}, admin, builtin))).rejects.toThrow("没有需要修改");
  });
  it("有待审批校对请求时拒绝删除；处理后删除会同时删除核对历史并留下审计快照", async () => {
    const item = await create();
    await db.query("INSERT INTO stock_reconcile_requests(stock_id, stock_label, status, requested_by) VALUES ($1,'示例','pending',1)", [item.id]);
    await expect(transaction((c) => deleteStockItem(c, item.id, admin))).rejects.toMatchObject({ status: 409 });
    await db.query("DELETE FROM stock_reconcile_requests WHERE stock_id=$1", [item.id]);
    await transaction((c) => deleteStockItem(c, item.id, admin));
    expect((await db.query("SELECT * FROM consumable_stock")).rows).toHaveLength(0);
    expect((await db.query("SELECT * FROM consumable_stock_checks")).rows).toHaveLength(0);
    const [log] = (await db.query<{ action: string; metadata_json: Record<string, unknown> }>("SELECT action, metadata_json FROM audit_logs WHERE action='material_stock.delete'")).rows;
    expect(log.metadata_json).toMatchObject({ category: "塑料耗材/吸头", item_name: "示例 200ul 吸头", quantity: 10 });
  });
});

describe("分类汇总与筛选", () => {
  it("按大类汇总已用完和需复核，标签卡按大类前缀过滤，也可按完整子类过滤，并保留空大类", async () => {
    const tip = await create({ item_name: "示例吸头甲", quantity: 1 });
    await create({ item_name: "示例吸头乙", quantity: 0 });
    await create({ item_name: "示例培养板", category: "塑料耗材/培养板皿", spec_model: "PLATE", quantity: undefined });
    await create({ item_name: "示例培养基", category: "生物试剂/培养基", spec_model: "MEDIUM", quantity: 4 });
    await db.query("UPDATE consumable_stock SET last_checked_at = now() - interval '40 days' WHERE id = $1", [tip.id]);
    const data = await listStock(query, new URLSearchParams(), builtin);
    expect(data.summary).toMatchObject({ item_count: 4, out_count: 1, stale_count: 2 });
    expect(data.groups.map((g) => g.name)).toEqual(["普通用品", "塑料耗材", "生物试剂", "试剂盒", "其他"]);
    expect(data.groups.find((g) => g.name === "塑料耗材")).toMatchObject({ item_count: 3, out_count: 1, stale_count: 2 });
    expect(data.groups.find((g) => g.name === "试剂盒")).toMatchObject({ item_count: 0 });
    expect(data.categories.find((c) => c.name === "塑料耗材/吸头")).toMatchObject({ item_count: 2, out_count: 1, stale_count: 1 });
    expect(data.items.every((i) => !("safety_stock" in i))).toBe(true);
    const names = async (sp: string) => (await listStock(query, new URLSearchParams(sp), builtin)).items.map((i) => i.item_name);
    expect(await names("status=out")).toEqual(["示例吸头乙"]);
    expect(await names("status=stale")).toEqual(["示例吸头甲", "示例培养板"]);
    expect(await names("status=ok")).toEqual(["示例培养基"]);
    expect(await names("category=塑料耗材")).toHaveLength(3);
    expect(await names("category=塑料耗材/培养板皿")).toEqual(["示例培养板"]);
    expect((await listStock(query, new URLSearchParams("category=塑料耗材"), builtin)).summary.item_count).toBe(4);
    expect(await names("q=培养板")).toHaveLength(1);
    expect(await names("q=不存在")).toHaveLength(0);
    await expect(listStock(query, new URLSearchParams("category=未知"), builtin)).rejects.toThrow("未知的耗材类别");
    for (const legacy of ["low", "unchecked", "未知"]) {
      await expect(listStock(query, new URLSearchParams(`status=${legacy}`), builtin)).rejects.toThrow("未知的库存状态");
    }
    await expect(listStock(query, new URLSearchParams("category=塑料耗材"), builtin)).resolves.toMatchObject({ category: "塑料耗材" });
  });
});

const purchase = (changes: Record<string, unknown> = {}) => db.query(
  `INSERT INTO material_items(request_no, material_code, department, status, item_name, brand, spec_model, unit, minor_category,
     requested_on, quantity, purchased_qty)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
  [changes.request_no ?? "EXAMPLE-REQ", changes.material_code ?? "EXAMPLE-M", changes.department ?? "示例部门甲",
    changes.status ?? "启用", changes.item_name ?? "200ul 吸头", changes.brand ?? "示例品牌",
    changes.spec_model ?? "EXAMPLE-SPEC", changes.unit ?? "盒", changes.minor_category ?? "示例小类",
    changes.requested_on ?? "2026-09-01", changes.quantity ?? 1, changes.purchased_qty ?? null]
);
let seq = 0;
const buy = (changes: Record<string, unknown> = {}) => { seq += 1; return purchase({ request_no: `EXAMPLE-REQ-${seq}`, material_code: `EXAMPLE-M-${seq}`, ...changes }); };
const NOW = new Date("2026-10-20T00:00:00Z").getTime();

describe("参考消耗/月与最近采购", () => {
  it("按名称+品牌+规格归一后从采购记录带出，别名和脏写法也能关联，无历史为空且不报错", async () => {
    await create({ item_name: "24孔板", brand: "Thermo Fisher", spec_model: "EXAMPLE-24W", unit: "箱" });
    await create({ item_name: "示例无采购耗材", spec_model: "EXAMPLE-NONE" });
    await create({ item_name: "示例单笔耗材", spec_model: "EXAMPLE-ONE" });
    // 同一品的三种写法：品牌别名、同义词、「货号:xx 名称:xx」。
    await buy({ item_name: "24孔细胞培养板", brand: "Invitrogen", spec_model: "EXAMPLE-24W", unit: "箱", requested_on: "2026-01-10", quantity: 4 });
    await buy({ item_name: "24 well plate", brand: "ABI", spec_model: "EXAMPLE-24W", unit: "箱", requested_on: "2026-03-05", quantity: 3, purchased_qty: 2 });
    await buy({ item_name: "货号:EXAMPLE-24W 名称:24孔板", brand: "thermo fisher", spec_model: "EXAMPLE-24W", unit: "箱", requested_on: "2026-06-20", quantity: 6 });
    // 不同单位、停用、非展示部门都不计入。
    await buy({ item_name: "24孔板", brand: "Thermo Fisher", spec_model: "EXAMPLE-24W", unit: "个", requested_on: "2026-05-01", quantity: 100 });
    await buy({ item_name: "24孔板", brand: "Thermo Fisher", spec_model: "EXAMPLE-24W", unit: "箱", requested_on: "2026-07-01", quantity: 50, status: "停用" });
    await buy({ item_name: "24孔板", brand: "Thermo Fisher", spec_model: "EXAMPLE-24W", unit: "箱", requested_on: "2026-08-01", quantity: 50, department: "示例其他部门" });
    await buy({ item_name: "示例单笔耗材", spec_model: "EXAMPLE-ONE", requested_on: "2026-02-01", quantity: 9 });
    const items = (await listStock(query, new URLSearchParams(), builtin, ["示例部门甲"], NOW)).items;
    const plate = items.find((i) => i.item_name === "24孔板");
    // (4 + 2 + 6) 箱 ÷ 2026-01 至 2026-06 共 6 个月 = 2；最近采购取 2026-06-20 那笔。
    expect(plate).toMatchObject({ monthly_usage: 2, last_purchase: { on: "2026-06-20", quantity: 6, unit: "箱" } });
    expect(items.find((i) => i.item_name === "示例无采购耗材")).toMatchObject({ monthly_usage: null, last_purchase: null });
    // 只有 1 笔采购时无法估算消耗，只带出最近采购。
    expect(items.find((i) => i.item_name === "示例单笔耗材")).toMatchObject({ monthly_usage: null, last_purchase: { on: "2026-02-01", quantity: 9, unit: "盒" } });
    // 未配置展示部门时两列为空。
    expect((await listStock(query, new URLSearchParams(), builtin)).items.every((i) => i.monthly_usage === null && i.last_purchase === null)).toBe(true);
  });
});

describe("从采购记录生成候选", () => {
  it("只取展示部门启用记录中近 12 个月复购（≥2 笔）的品，生成需复核条目；重复执行不新增", async () => {
    await buy({ item_name: "200ul 吸头", requested_on: "2026-09-01" });
    await buy({ item_name: "200ul 吸头", requested_on: "2026-05-01" });
    await buy({ item_name: "DMEM 培养基", brand: "示例品牌乙", requested_on: "2026-08-01" });
    await buy({ item_name: "DMEM 培养基", brand: "示例品牌乙", requested_on: "2025-12-01" });
    await buy({ item_name: "移液管", department: "示例其他部门" });
    await buy({ item_name: "移液管", department: "示例其他部门" });
    await buy({ item_name: "停用吸头", status: "停用" });
    await buy({ item_name: "停用吸头", status: "停用" });
    await buy({ item_name: "不匹配的瓶子" });
    await buy({ item_name: "不匹配的瓶子" });
    // 一次性采购与 12 个月前的复购不进候选池。
    await buy({ item_name: "单次 ELISA 试剂盒" });
    await buy({ item_name: "旧 T25 培养瓶", requested_on: "2023-07-01" });
    await buy({ item_name: "旧 T25 培养瓶", requested_on: "2023-09-01" });
    const first = await transaction((c) => syncStockCandidates(c, ["示例部门甲"], builtin, admin, undefined, NOW));
    expect(first).toMatchObject({ scanned: 5, candidates: 2, created: 2, skipped: 0 });
    const rows = (await db.query<{ category: string; item_name: string; quantity: string; note: string; last_checked_at: string | null }>(
      "SELECT category, item_name, quantity, note, last_checked_at FROM consumable_stock ORDER BY item_name"
    )).rows;
    expect(rows.map((r) => [r.category, r.item_name])).toEqual([["塑料耗材/吸头", "200ul 吸头"], ["生物试剂/培养基", "DMEM 培养基"]]);
    expect(rows.every((r) => Number(r.quantity) === 0 && r.last_checked_at === null && r.note.includes("待首次核对"))).toBe(true);
    expect(await transaction((c) => syncStockCandidates(c, ["示例部门甲"], builtin, admin, undefined, NOW))).toMatchObject({ candidates: 2, created: 0, skipped: 2 });
    await expect(transaction((c) => syncStockCandidates(c, [], builtin, admin))).rejects.toThrow("展示部门");
  });
  it("品牌别名、同义词、脏写法和 200T/200 tests 规格先归一，拆开的行合并成一个候选并以标准写法入库", async () => {
    await buy({ item_name: "示例 ELISA Kit", brand: "Vazyme", spec_model: "EXAMPLE-EK 200 tests", requested_on: "2026-09-01" });
    await buy({ item_name: "货号:EXAMPLE-EK 名称:示例 ELISA Kit", brand: "诺唯赞", spec_model: "EXAMPLE-EK 200Test", requested_on: "2026-03-01" });
    await buy({ item_name: "示例 ELISA Kit", brand: "南京诺唯赞", spec_model: "EXAMPLE-EK 200T", requested_on: "2026-01-01" });
    await buy({ item_name: "示例8连管", brand: "Titan/泰坦", requested_on: "2026-09-15" });
    await buy({ item_name: "示例8联排管", brand: "探索平台", requested_on: "2026-04-15" });
    const result = await transaction((c) => syncStockCandidates(c, ["示例部门甲"], builtin, admin, undefined, NOW));
    expect(result).toMatchObject({ scanned: 5, candidates: 2, created: 2 });
    const rows = (await db.query<{ category: string; item_name: string; brand: string; spec_model: string }>(
      "SELECT category, item_name, brand, spec_model FROM consumable_stock ORDER BY id"
    )).rows;
    expect(rows).toEqual([
      { category: "塑料耗材/PCR板连管封膜", item_name: "示例8连管", brand: "泰坦", spec_model: "EXAMPLE-SPEC" },
      { category: "试剂盒/检测试剂盒", item_name: "示例 ELISA Kit", brand: "诺唯赞", spec_model: "EXAMPLE-EK 200T" },
    ]);
  });
  it("已有同一归一键的条目（即使写法不同）不再新建", async () => {
    await create({ item_name: "示例吸头", brand: "Thermo Fisher", spec_model: "EXAMPLE-TIP" });
    await buy({ item_name: "示例吸头", brand: "Invitrogen", spec_model: "EXAMPLE-TIP" });
    await buy({ item_name: "示例 吸头", brand: "ABI", spec_model: "EXAMPLE-TIP" });
    const result = await transaction((c) => syncStockCandidates(c, ["示例部门甲"], builtin, admin, undefined, NOW));
    expect(result).toMatchObject({ candidates: 1, created: 0, skipped: 1 });
    expect((await db.query("SELECT 1 FROM consumable_stock")).rows).toHaveLength(1);
  });
});
