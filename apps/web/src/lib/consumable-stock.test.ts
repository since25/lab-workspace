import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import { MaterialError } from "./materials-data";
import type { MaterialQuery } from "./materials-list";
import { normalizeStockText, stockCategories, stockGroups, stockStale, stockStatus, STOCK_STALE_DAYS } from "./consumables";
import {
  checkStock, createStockItem, decideLink, deleteStockItem, initSlotTemplates, listChecks, listLinks, listStock, matchPurchases, updateStockItem,
} from "./consumable-stock";
import { SLOT_TEMPLATES } from "./consumable-slots";

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
  await db.exec(await readFile(new URL("../../../../db/migrations/013_consumable_slots.sql", import.meta.url), "utf8"));
  await db.exec("INSERT INTO users(id,username,display_name,password_hash,role) VALUES (1,'example-admin','示例管理员','example-hash','admin'),(2,'example-member','示例成员','example-hash','member')");
}, 30000);
beforeEach(async () => {
  await db.exec("TRUNCATE consumable_stock, consumable_stock_checks, consumable_stock_skus, consumable_stock_links, material_items, audit_logs RESTART IDENTITY CASCADE");
});
afterAll(() => db.close());

describe("类别配置与分类", () => {
  it("默认类别来自槽位模板：五个大类 + 其他，名称唯一，每个模板槽位的类别都在其中", () => {
    expect(stockGroups(builtin)).toEqual(["细胞耗材", "塑料耗材", "通用耗材", "培养基", "常用试剂", "其他"]);
    expect(new Set(builtin.map((c) => c.name)).size).toBe(builtin.length);
    expect(SLOT_TEMPLATES.every((t) => builtin.some((c) => c.name === t.category))).toBe(true);
  });
  it("配置支持只写名称或带 keywords 的旧格式，标签卡随配置的大类变化", () => {
    const names = stockCategories('[" 塑料耗材/吸头 ","示例类别"]');
    expect(names.map((c) => c.name)).toEqual(["塑料耗材/吸头", "示例类别"]);
    expect(stockGroups(names)).toEqual(["塑料耗材", "示例类别"]);
    const legacy = stockCategories('[{"name":"耗材甲","keywords":[" 特别耗材 ","EXAMPLE"]}]');
    expect(legacy[0]).toEqual({ name: "耗材甲", keywords: ["特别耗材", "example"] });
    expect(normalizeStockText(" ＤＭＥＭ  高糖 ")).toBe("dmem高糖");
  });
  it("配置为空、重复、类型错误或坏 JSON 时按配置错误处理", () => {
    for (const raw of ["[]", "broken", '["吸头","吸头"]', '[{"name":""}]', '[{"name":"甲","keywords":"x"}]', '[{"name":"甲","keywords":[""]}]']) {
      expect(() => stockCategories(raw)).toThrow(MaterialError);
    }
  });
  it("库存状态三态：数量 0 为需采购，从未核对或超过期限为需复核，其余正常", () => {
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
    expect(item.baseline_at).toBe(item.last_checked_at);
    expect(item).not.toHaveProperty("safety_stock");
    const checks = await listChecks(query, item.id);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ before_qty: 0, after_qty: 10, note: "建立库存", checked_by_name: "示例管理员" });
    expect((await db.query("SELECT action FROM audit_logs")).rows).toEqual([{ action: "material_stock.create" }]);
  });
  it("不填初始数量时条目标为需复核（不当作需采购），不生成核对记录，也没有基线", async () => {
    const item = await create({ quantity: undefined });
    expect(item).toMatchObject({ status: "stale", last_checked_at: null, quantity: 0, baseline_at: null });
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
    expect((await listChecks(query, item.id)).map((r) => [r.before_qty, r.after_qty, r.note, r.kind])).toEqual([[10, 3, "用掉 7 盒", "check"], [0, 10, "建立库存", "check"]]);
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
  it("按大类汇总需采购和需复核，标签卡按大类前缀过滤，也可按完整子类过滤，并保留空大类", async () => {
    const tip = await create({ item_name: "示例吸头甲", quantity: 1 });
    await create({ item_name: "示例吸头乙", quantity: 0 });
    await create({ item_name: "示例培养板", category: "细胞耗材/细胞培养板", spec_model: "PLATE", quantity: undefined });
    await create({ item_name: "示例培养基", category: "培养基/基础培养基", spec_model: "MEDIUM", quantity: 4 });
    await db.query("UPDATE consumable_stock SET last_checked_at = now() - interval '40 days' WHERE id = $1", [tip.id]);
    const data = await listStock(query, new URLSearchParams(), builtin);
    expect(data.summary).toMatchObject({ item_count: 4, out_count: 1, stale_count: 2 });
    expect(data.groups.map((g) => g.name)).toEqual(["细胞耗材", "塑料耗材", "通用耗材", "培养基", "常用试剂", "其他"]);
    expect(data.groups.find((g) => g.name === "塑料耗材")).toMatchObject({ item_count: 2, out_count: 1, stale_count: 1 });
    expect(data.groups.find((g) => g.name === "常用试剂")).toMatchObject({ item_count: 0 });
    expect(data.review).toEqual({ pending: 0, inbound: 0 });
    expect(data.categories.find((c) => c.name === "塑料耗材/吸头")).toMatchObject({ item_count: 2, out_count: 1, stale_count: 1 });
    expect(data.items.every((i) => !("safety_stock" in i))).toBe(true);
    const names = async (sp: string) => (await listStock(query, new URLSearchParams(sp), builtin)).items.map((i) => i.item_name);
    expect(await names("status=out")).toEqual(["示例吸头乙"]);
    // 按模板类别顺序：细胞耗材排在塑料耗材前。
    expect(await names("status=stale")).toEqual(["示例培养板", "示例吸头甲"]);
    expect(await names("status=ok")).toEqual(["示例培养基"]);
    expect(await names("category=塑料耗材")).toHaveLength(2);
    expect(await names("category=细胞耗材/细胞培养板")).toEqual(["示例培养板"]);
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

const DEPT = ["示例部门甲"];
const slotId = async (key: string) => (await db.query<{ id: number }>("SELECT id FROM consumable_stock WHERE slot_key=$1", [key])).rows[0].id;
const linkState = async () => (await db.query<{ item_name: string; state: string; confidence: string; slot_key: string | null }>(
  `SELECT m.item_name, l.state, l.confidence, s.slot_key FROM consumable_stock_links l
   JOIN material_items m ON m.id = l.material_id LEFT JOIN consumable_stock s ON s.id = l.stock_id ORDER BY m.id`
)).rows.map((r) => [r.item_name, r.state, r.confidence, r.slot_key]);
const decide = (materialId: number, input: Record<string, unknown>) => transaction((c) => decideLink(c, materialId, input, admin));
const match = () => transaction((c) => matchPurchases(c, DEPT, admin));

describe("槽位模板与采购匹配", () => {
  it("建立模板只补缺失槽位：数量 0、待核对；重复执行不新增，改过名称的模板槽位不被覆盖", async () => {
    const first = await transaction((c) => initSlotTemplates(c, builtin, admin));
    expect(first).toEqual({ templates: SLOT_TEMPLATES.length, created: SLOT_TEMPLATES.length, skipped: 0 });
    await db.query("UPDATE consumable_stock SET item_name='示例改名' WHERE slot_key='plate-48'");
    expect(await transaction((c) => initSlotTemplates(c, builtin, admin))).toMatchObject({ created: 0, skipped: SLOT_TEMPLATES.length });
    const data = await listStock(query, new URLSearchParams("category=塑料耗材/吸头"), builtin);
    expect(data.items.map((i) => i.item_name)).toEqual(["10µL 吸头", "10µL 滤芯吸头", "200µL 吸头", "200µL 滤芯吸头", "1000/1250µL 吸头", "1000/1250µL 滤芯吸头"]);
    expect(data.items.every((i) => i.status === "stale" && i.unit === "箱" && i.skus.length === 0)).toBe(true);
    expect((await db.query("SELECT item_name FROM consumable_stock WHERE slot_key='plate-48'")).rows).toEqual([{ item_name: "示例改名" }]);
    // 类别配置里没有的模板不建。
    await db.exec("TRUNCATE consumable_stock RESTART IDENTITY CASCADE");
    expect(await transaction((c) => initSlotTemplates(c, stockCategories('["塑料耗材/吸头"]'), admin))).toMatchObject({ templates: 6, created: 6 });
  });
  it("匹配只处理展示部门启用记录，给出建议和把握；长尾不建记录；重复匹配不重复处理", async () => {
    await expect(match()).rejects.toThrow("建立槽位模板");
    await transaction((c) => initSlotTemplates(c, builtin, admin));
    await buy({ item_name: "200ul吸头滤芯低吸附盒装灭菌", brand: "示例品牌", spec_model: "EXAMPLE-TF-200", unit: "箱", minor_category: "耗材" });
    await buy({ item_name: "24孔细胞培养板，平底，TC", spec_model: "EXAMPLE-24", unit: "箱", minor_category: "耗材" });
    await buy({ item_name: "人 alpha 1 Antitrypsin ELISA试剂盒", minor_category: "试剂盒" });
    await buy({ item_name: "示例 Trypsin 0.25% EDTA", minor_category: "生物试剂" });
    await buy({ item_name: "DMEM 培养基", minor_category: "耗材" });
    await buy({ item_name: "6孔板 未TC", minor_category: "耗材" });
    await buy({ item_name: "示例抗体", minor_category: "生物试剂" });
    await buy({ item_name: "200ul吸头", department: "示例其他部门" });
    await buy({ item_name: "200ul吸头", status: "停用" });
    const result = await match();
    expect(result).toEqual({ scanned: 7, suggested: 4, known: 0, excluded: 0, unmatched: 3 });
    expect(await linkState()).toEqual([
      ["200ul吸头滤芯低吸附盒装灭菌", "pending", "high", "tip-200f"],
      ["24孔细胞培养板，平底，TC", "pending", "high", "plate-24"],
      ["示例 Trypsin 0.25% EDTA", "pending", "high", "trypsin"],
      ["DMEM 培养基", "pending", "mid", "dmem"],
    ]);
    // 已建记录的不再处理；没命中的长尾每次重扫（以后新增槽位或规则时还能归入）。
    expect(await match()).toEqual({ scanned: 3, suggested: 0, known: 0, excluded: 0, unmatched: 3 });
    await expect(transaction((c) => matchPurchases(c, [], admin))).rejects.toThrow("展示部门");
    const links = await listLinks(query, new URLSearchParams());
    expect(links.counts).toEqual({ pending: 4, inbound: 0 });
    expect(links.items[0]).toMatchObject({ slot_label: "细胞耗材/细胞培养板 · 24孔板 TC", slot_unit: "箱", quantity: 1 });
    await expect(listLinks(query, new URLSearchParams("view=x"))).rejects.toThrow("未知的核对视图");
  });
  it("确认会记住货号并带走同货号的待确认记录；以后同货号采购直接归入，排除过的直接排除", async () => {
    await transaction((c) => initSlotTemplates(c, builtin, admin));
    await buy({ item_name: "示例 10ul 吸头", brand: "示例品牌", spec_model: "EXAMPLE-T10", requested_on: "2026-01-01" });
    await buy({ item_name: "示例 10ul 吸头", brand: "示例品牌", spec_model: "EXAMPLE-T10", requested_on: "2026-03-01" });
    await buy({ item_name: "示例 Phanta Ultra", spec_model: "EXAMPLE-P528" });
    await match();
    // 第一条改归到滤芯吸头槽位，同货号的另一条一起归入。
    expect(await decide(1, { action: "confirm", stock_id: await slotId("tip-10f") })).toEqual({ updated: 2 });
    expect(await decide(3, { action: "exclude" })).toEqual({ updated: 1 });
    expect(await linkState()).toEqual([
      ["示例 10ul 吸头", "confirmed", "high", "tip-10f"], ["示例 10ul 吸头", "confirmed", "high", "tip-10f"], ["示例 Phanta Ultra", "excluded", "low", null],
    ]);
    await buy({ item_name: "示例  10ul 吸头", brand: "示例品牌", spec_model: "EXAMPLE-T10", requested_on: "2026-09-01" });
    await buy({ item_name: "示例 Phanta Ultra", spec_model: "EXAMPLE-P528", requested_on: "2026-09-02" });
    expect(await match()).toMatchObject({ scanned: 2, known: 1, excluded: 1, suggested: 0 });
    const [slot] = (await listStock(query, new URLSearchParams("q=10µL 滤芯"), builtin)).items;
    expect(slot.skus).toEqual([{ item_name: "示例 10ul 吸头", brand: "示例品牌", spec_model: "EXAMPLE-T10" }]);
    expect(slot.last_purchase).toEqual({ on: "2026-09-01", quantity: 1, unit: "盒" });
    // 尚未核对（无基线）时没有待入库，也不能入库。
    expect(slot.pending_inbound).toBe(0);
    await expect(decide(4, { action: "stock" })).rejects.toThrow("基线之后");
    await expect(decide(1, { action: "confirm", stock_id: 9999 })).rejects.toMatchObject({ status: 404 });
    await expect(decide(1, { action: "unknown" })).rejects.toThrow("未知的处理动作");
    await expect(decide(999, { action: "exclude" })).rejects.toMatchObject({ status: 404 });
  });
  it("基线之后的采购才进待入库：入库加数并记入库历史，不加数只改状态；基线日及以前的采购视为已计入", async () => {
    await transaction((c) => initSlotTemplates(c, builtin, admin));
    const tip = await slotId("tip-200");
    await buy({ item_name: "示例 200ul 吸头", spec_model: "EXAMPLE-T200", unit: "箱", requested_on: "2026-01-01", quantity: 2 });
    await match();
    await decide(1, { action: "confirm" });
    await db.query("UPDATE consumable_stock SET quantity=5, last_checked_at=now(), baseline_at='2026-06-01T04:00:00Z' WHERE id=$1", [tip]);
    await buy({ item_name: "示例 200ul 吸头", spec_model: "EXAMPLE-T200", unit: "箱", requested_on: "2026-06-01", quantity: 9 });
    await buy({ item_name: "示例 200ul 吸头", spec_model: "EXAMPLE-T200", unit: "箱", requested_on: "2026-07-01", quantity: 3 });
    await buy({ item_name: "示例 200ul 吸头", spec_model: "EXAMPLE-T200", unit: "箱", requested_on: "2026-08-01", quantity: 4 });
    await match();
    const inbound = await listLinks(query, new URLSearchParams("view=inbound"));
    expect(inbound.items.map((i) => [i.requested_on, i.quantity])).toEqual([["2026-08-01", 4], ["2026-07-01", 3]]);
    expect((await listStock(query, new URLSearchParams("q=200µL 吸头"), builtin)).items[0].pending_inbound).toBe(2);
    const stocked = await decide(3, { action: "stock", quantity: 2 });
    expect(stocked.stock).toMatchObject({ quantity: 7, revision: 1 });
    await expect(decide(4, { action: "stock", quantity: 0 })).rejects.toThrow("大于 0");
    await decide(4, { action: "skip" });
    await expect(decide(3, { action: "stock" })).rejects.toThrow("基线之后");
    await expect(decide(3, { action: "exclude" })).rejects.toThrow("已入库");
    const history = await listChecks(query, tip);
    expect(history[0]).toMatchObject({ before_qty: 5, after_qty: 7, kind: "inbound" });
    expect(history[0].note).toContain("入库：EXAMPLE-REQ-");
    const done = await listLinks(query, new URLSearchParams("view=done"));
    expect(done.items.map((i) => [i.state, i.applied_qty, i.decided_by_name])).toEqual([["skipped", null, "示例管理员"], ["stocked", 2, "示例管理员"]]);
    expect(done.counts).toEqual({ pending: 0, inbound: 0 });
  });
  it("消耗/月：盘点满 28 天按盘点差计算（入库不算消耗），否则按已归入的同单位采购估算", async () => {
    await transaction((c) => initSlotTemplates(c, builtin, admin));
    const tube = await slotId("tube-1.5");
    await buy({ item_name: "示例 1.5mL 离心管", spec_model: "EXAMPLE-T15", unit: "箱", requested_on: "2026-01-10", quantity: 4 });
    await buy({ item_name: "示例 1.5mL 离心管", spec_model: "EXAMPLE-T15", unit: "箱", requested_on: "2026-06-20", quantity: 8 });
    await buy({ item_name: "示例 1.5mL 离心管", spec_model: "EXAMPLE-T15", unit: "盒", requested_on: "2026-07-20", quantity: 50 });
    await match();
    await decide(1, { action: "confirm" });
    const usage = async () => (await listStock(query, new URLSearchParams("q=1.5mL"), builtin)).items[0];
    // (4 + 8) 箱 ÷ 2026-01 至 2026-06 共 6 个月 = 2；「盒」那笔不同单位不计入。
    expect(await usage()).toMatchObject({ monthly_usage: 2, usage_basis: "purchases", last_purchase: { on: "2026-07-20", quantity: 50, unit: "盒" } });
    await db.query("UPDATE consumable_stock SET quantity=10, last_checked_at='2026-08-01', baseline_at='2026-08-01' WHERE id=$1", [tube]);
    await db.query(
      `INSERT INTO consumable_stock_checks(stock_id, before_qty, after_qty, checked_at, kind) VALUES
       ($1,0,10,'2026-08-01','check'), ($1,10,16,'2026-08-20','inbound'), ($1,16,12,'2026-09-01','check'), ($1,12,9,'2026-09-30','check')`, [tube]
    );
    // 基线后盘点共减少 4 + 3 = 7 箱，2026-08-01 至 09-30 共 60 天 ≈ 1.97 个月 → 3.55 箱/月；入库的 +6 不算消耗。
    expect(await usage()).toMatchObject({ monthly_usage: 3.55, usage_basis: "checks" });
  });
});
