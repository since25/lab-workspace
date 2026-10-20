import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import { MaterialError } from "./materials-data";
import type { MaterialQuery } from "./materials-list";
import {
  classifyConsumable, normalizeStockText, stockCategories, stockStale, stockStatus,
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
  category: "吸头", item_name: "示例 200ul 吸头", brand: "示例品牌", spec_model: "EXAMPLE-TIP", unit: "盒",
  quantity: 10, safety_stock: 3, note: "示例备注", ...changes,
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
  it("默认类别覆盖吸头、培养板、移液管、离心管、培养基，名称唯一", () => {
    expect(builtin.map((c) => c.name)).toEqual(["吸头", "细胞培养板", "移液管", "离心管", "培养基"]);
  });
  it("配置支持只写名称（沿用内置关键词）和自定义关键词", () => {
    const names = stockCategories('[" 吸头 ","示例类别"]');
    expect(names.map((c) => c.name)).toEqual(["吸头", "示例类别"]);
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
  it("按名称、规格和小类关键词识别五类常用耗材，未命中返回空", () => {
    expect(classifyConsumable("200ul 滤芯吸头", builtin)).toBe("吸头");
    expect(classifyConsumable("T25 细胞培养瓶", builtin)).toBeNull();
    expect(classifyConsumable("6 孔板", builtin)).toBe("细胞培养板");
    expect(classifyConsumable("10mL 移液管", builtin)).toBe("移液管");
    expect(classifyConsumable("1.5mL EP管", builtin)).toBe("离心管");
    expect(classifyConsumable("DMEM 高糖培养基", builtin)).toBe("培养基");
    expect(normalizeStockText(" ＤＭＥＭ  高糖 ")).toBe("dmem高糖");
  });
  it("库存状态区分未核对、缺货、偏低和正常，超过期限标记待复核", () => {
    const now = new Date("2026-10-20T00:00:00Z").getTime();
    expect(stockStatus({ quantity: 0, safety_stock: 3, last_checked_at: null })).toBe("unchecked");
    expect(stockStatus({ quantity: 0, safety_stock: 3, last_checked_at: "2026-10-19T00:00:00Z" })).toBe("out");
    expect(stockStatus({ quantity: 2, safety_stock: 3, last_checked_at: "2026-10-19T00:00:00Z" })).toBe("low");
    expect(stockStatus({ quantity: 4, safety_stock: 3, last_checked_at: "2026-10-19T00:00:00Z" })).toBe("ok");
    expect(stockStale({ quantity: 4, safety_stock: 0, last_checked_at: null }, now)).toBe(true);
    expect(stockStale({ quantity: 4, safety_stock: 0, last_checked_at: "2026-10-01T00:00:00Z" }, now)).toBe(false);
    expect(stockStale({ quantity: 4, safety_stock: 0, last_checked_at: new Date(now - (STOCK_STALE_DAYS + 1) * 86400000).toISOString() }, now)).toBe(true);
  });
});

describe("库存条目与核对台账", () => {
  it("迁移建表后采购记录照常保存；新建带初始数量的条目会写一条建立库存记录", async () => {
    await db.query("INSERT INTO material_items(request_no, material_code, item_name) VALUES ('EXAMPLE-LEGACY','EXAMPLE-LEGACY','示例历史记录')");
    const item = await create();
    expect((await db.query("SELECT item_name FROM material_items WHERE request_no='EXAMPLE-LEGACY'")).rows).toHaveLength(1);
    expect(item).toMatchObject({ category: "吸头", quantity: 10, safety_stock: 3, status: "ok", revision: 0, checked_by_name: "示例管理员" });
    const checks = await listChecks(query, item.id);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ before_qty: 0, after_qty: 10, note: "建立库存", checked_by_name: "示例管理员" });
    expect((await db.query("SELECT action FROM audit_logs")).rows).toEqual([{ action: "material_stock.create" }]);
  });
  it("不填初始数量时条目标为待核对，不生成核对记录", async () => {
    const item = await create({ quantity: undefined });
    expect(item).toMatchObject({ status: "unchecked", last_checked_at: null, quantity: 0 });
    expect(await listChecks(query, item.id)).toHaveLength(0);
  });
  it("同名同品牌同规格拒绝重复；非法类别、空名称和负数被拒绝", async () => {
    await create();
    await expect(create()).rejects.toMatchObject({ status: 409 });
    await expect(create({ category: "不存在的类别" })).rejects.toThrow("耗材类别");
    await expect(create({ item_name: "  " })).rejects.toThrow("名称");
    await expect(create({ quantity: -1 })).rejects.toThrow("0 至 10 亿");
    await expect(create({ safety_stock: "abc" })).rejects.toThrow("安全库存");
  });
  it("核对覆盖数量并保留改前/改后，旧 revision 再提交会被拒绝且不覆盖", async () => {
    const item = await create();
    const checked = await transaction((c) => checkStock(c, item.id, { quantity: 3, note: "用掉 7 盒", expected_revision: item.revision }, member));
    expect(checked).toMatchObject({ quantity: 3, status: "low", revision: 1 });
    expect((await listChecks(query, item.id)).map((r) => [r.before_qty, r.after_qty, r.note])).toEqual([[10, 3, "用掉 7 盒"], [0, 10, "建立库存"]]);
    await expect(transaction((c) => checkStock(c, item.id, { quantity: 1, expected_revision: item.revision }, member)))
      .rejects.toMatchObject({ status: 409 });
    const [row] = (await db.query<{ quantity: string }>("SELECT quantity FROM consumable_stock WHERE id=$1", [item.id])).rows;
    expect(Number(row.quantity)).toBe(3);
    await expect(transaction((c) => checkStock(c, item.id, { quantity: -2 }, admin))).rejects.toThrow("0 至 10 亿");
    await expect(transaction((c) => checkStock(c, 999, { quantity: 1 }, admin))).rejects.toMatchObject({ status: 404 });
  });
  it("编辑只改基础信息和安全库存，数量必须走核对；改重名时冲突", async () => {
    const first = await create();
    const second = await create({ item_name: "示例 10ul 吸头", spec_model: "EXAMPLE-TIP-10" });
    const updated = await transaction((c) => updateStockItem(c, first.id, { safety_stock: 8, note: "新备注", unit: "箱" }, admin, builtin));
    expect(updated).toMatchObject({ safety_stock: 8, note: "新备注", unit: "箱", revision: 1 });
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
    expect(log.metadata_json).toMatchObject({ category: "吸头", item_name: "示例 200ul 吸头", quantity: 10 });
  });
});

describe("分类汇总与筛选", () => {
  it("按类别汇总条目、待核对、缺货、偏低和待复核，并保留空类别", async () => {
    const tip = await create({ item_name: "示例吸头甲", quantity: 1, safety_stock: 3 });
    await create({ item_name: "示例吸头乙", quantity: 0, safety_stock: 3 });
    await create({ item_name: "示例培养板", category: "细胞培养板", spec_model: "PLATE", quantity: undefined });
    await db.query("UPDATE consumable_stock SET last_checked_at = now() - interval '40 days' WHERE id = $1", [tip.id]);
    const data = await listStock(query, new URLSearchParams(), builtin);
    expect(data.summary).toMatchObject({ item_count: 3, unchecked_count: 1, out_count: 1, low_count: 1, stale_count: 1 });
    const tips = data.categories.find((c) => c.name === "吸头");
    expect(tips).toMatchObject({ item_count: 2, out_count: 1, low_count: 1, stale_count: 1 });
    expect(data.categories.find((c) => c.name === "培养基")).toMatchObject({ item_count: 0 });
    expect((await listStock(query, new URLSearchParams("status=low"), builtin)).items.map((i) => i.item_name)).toEqual(["示例吸头甲"]);
    expect((await listStock(query, new URLSearchParams("status=unchecked"), builtin)).items.map((i) => i.item_name)).toEqual(["示例培养板"]);
    expect((await listStock(query, new URLSearchParams("category=细胞培养板"), builtin)).items).toHaveLength(1);
    expect((await listStock(query, new URLSearchParams("category=吸头"), builtin)).summary.item_count).toBe(3);
    expect((await listStock(query, new URLSearchParams("q=培养板"), builtin)).items).toHaveLength(1);
    expect((await listStock(query, new URLSearchParams("q=不存在"), builtin)).items).toHaveLength(0);
    await expect(listStock(query, new URLSearchParams("category=未知"), builtin)).rejects.toThrow("未知的耗材类别");
    await expect(listStock(query, new URLSearchParams("status=未知"), builtin)).rejects.toThrow("未知的库存状态");
    await expect(listStock(query, new URLSearchParams("category=吸头"), builtin)).resolves.toMatchObject({ category: "吸头" });
  });
});

describe("从采购记录生成候选", () => {
  const purchase = (changes: Record<string, unknown> = {}) => db.query(
    `INSERT INTO material_items(request_no, material_code, department, status, item_name, brand, spec_model, unit, minor_category)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [changes.request_no ?? "EXAMPLE-REQ", changes.material_code ?? "EXAMPLE-M", changes.department ?? "示例部门甲",
      changes.status ?? "启用", changes.item_name ?? "200ul 吸头", changes.brand ?? "示例品牌",
      changes.spec_model ?? "EXAMPLE-SPEC", changes.unit ?? "盒", changes.minor_category ?? "示例小类"]
  );

  it("只匹配展示部门内的启用记录，生成待核对条目；重复执行不新增", async () => {
    await purchase();
    await purchase({ request_no: "EXAMPLE-REQ-2", material_code: "EXAMPLE-M-2", item_name: "DMEM 培养基" });
    await purchase({ request_no: "EXAMPLE-REQ-3", material_code: "EXAMPLE-M-3", item_name: "移液管", department: "示例其他部门" });
    await purchase({ request_no: "EXAMPLE-REQ-4", material_code: "EXAMPLE-M-4", item_name: "停用吸头", status: "停用" });
    await purchase({ request_no: "EXAMPLE-REQ-5", material_code: "EXAMPLE-M-5", item_name: "不匹配的瓶子" });
    const first = await transaction((c) => syncStockCandidates(c, ["示例部门甲"], builtin, admin));
    expect(first).toMatchObject({ scanned: 3, candidates: 2, created: 2, skipped: 0 });
    const rows = (await db.query<{ category: string; item_name: string; quantity: string; note: string; last_checked_at: string | null }>(
      "SELECT category, item_name, quantity, note, last_checked_at FROM consumable_stock ORDER BY item_name"
    )).rows;
    expect(rows.map((r) => [r.category, r.item_name])).toEqual([["吸头", "200ul 吸头"], ["培养基", "DMEM 培养基"]]);
    expect(rows.every((r) => Number(r.quantity) === 0 && r.last_checked_at === null && r.note.includes("待首次核对"))).toBe(true);
    expect(await transaction((c) => syncStockCandidates(c, ["示例部门甲"], builtin, admin))).toMatchObject({ candidates: 2, created: 0, skipped: 2 });
    await expect(transaction((c) => syncStockCandidates(c, [], builtin, admin))).rejects.toThrow("展示部门");
  });
});
