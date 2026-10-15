import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import type { MaterialRow } from "./imports/materials";
import { changeMaterialUsage, displayDepartments, importMaterialRows, materialIds, parseUsageAction, validateMaterialKeys } from "./materials-data";
import { listMaterials, listUsageRequests, type MaterialQuery } from "./materials-list";

// 所有部门、人员和采购记录均为虚构；数据库只在进程内存在。
const db = new PGlite();
const departments = ["示例部门甲", "示例部门乙"];
const admin = { id: 1, role: "admin" };
const member = { id: 2, role: "member" };
const otherMember = { id: 3, role: "member" };
const transaction = <T>(fn: (c: PoolClient) => Promise<T>) => db.transaction(c => fn(c as unknown as PoolClient));
const query: MaterialQuery = async <T>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params)).rows;
const row = (changes: Partial<MaterialRow> = {}): MaterialRow => ({
  requested_on: "2026-01-01", requester: "示例成员", department: departments[0], request_no: "EXAMPLE-REQ-1",
  material_code: "EXAMPLE-M-1", status: "启用", major_category: "示例大类", minor_category: "示例小类",
  item_name: "示例耗材", brand: "示例品牌", spec_model: "EXAMPLE-SPEC", unit: "盒", quantity: 2,
  is_urgent: false, project_code: "EXAMPLE-PRJ", remarks: "示例备注", order_no: "EXAMPLE-ORD",
  purchased_qty: 2, last_received_on: null, received_qty: 0, receipt_status: "未收货", ...changes,
});
const sync = (rows: MaterialRow[]) => transaction(c => importMaterialRows(c, rows, "example.csv", null));
const usage = (user: typeof admin, ids: number[], action: "mark" | "restore" | "approve" | "reject") =>
  transaction(c => changeMaterialUsage(c, user, ids, action, departments));
let migratedLegacy: Record<string, unknown>;

beforeAll(async () => {
  await db.exec(await readFile(new URL("../../../../db/migrations/001_init.sql", import.meta.url), "utf8"));
  await db.exec("INSERT INTO material_items(id, request_no, material_code) VALUES (900, 'EXAMPLE-LEGACY', 'EXAMPLE-LEGACY')");
  await db.exec(await readFile(new URL("../../../../db/migrations/009_material_usage.sql", import.meta.url), "utf8"));
  migratedLegacy = (await db.query<Record<string, unknown>>("SELECT id, is_used_up, used_up_requested_at FROM material_items WHERE id=900")).rows[0];
  await db.exec("INSERT INTO users(id,username,display_name,password_hash,role) VALUES (1,'example-admin','示例管理员','example-hash','admin'),(2,'example-member','示例成员','example-hash','member'),(3,'example-member-2','示例成员乙','example-hash','member')");
}, 30000);
beforeEach(async () => { await db.exec("TRUNCATE material_items, import_batches, audit_logs RESTART IDENTITY CASCADE"); });
afterAll(() => db.close());

describe("采购记录增量更新", () => {
  it("迁移保留既有 ID，旧记录默认未用完且无申请", () => {
    expect(migratedLegacy).toMatchObject({ id: 900, is_used_up: false, used_up_requested_at: null });
  });
  it("迁移遇到既有重复组合时失败回滚，原采购记录不被清理", async () => {
    const legacy = new PGlite();
    try {
      await legacy.exec(await readFile(new URL("../../../../db/migrations/001_init.sql", import.meta.url), "utf8"));
      await legacy.exec("INSERT INTO material_items(request_no,material_code) VALUES ('EXAMPLE-REQ','EXAMPLE-M'),('EXAMPLE-REQ','EXAMPLE-M')");
      await legacy.exec("BEGIN");
      await expect(legacy.exec(await readFile(new URL("../../../../db/migrations/009_material_usage.sql", import.meta.url), "utf8"))).rejects.toThrow();
      await legacy.exec("ROLLBACK");
      expect((await legacy.query("SELECT * FROM material_items")).rows).toHaveLength(2);
      expect((await legacy.query("SELECT column_name FROM information_schema.columns WHERE table_name='material_items' AND column_name='is_used_up'")).rows).toHaveLength(0);
    } finally { await legacy.close(); }
  });
  it("全量录入所有部门，保留同名不同编码、同编码不同采购单；重复同步不增加记录", async () => {
    const rows = [row(), row({ request_no: "EXAMPLE-REQ-2" }), row({ material_code: "EXAMPLE-M-2", department: departments[1] }),
      row({ material_code: "EXAMPLE-M-3", department: "示例其他部门" })];
    expect(await sync(rows)).toMatchObject({ inserted: 4, updated: 0, unchanged: 0 });
    expect(await sync(rows)).toMatchObject({ inserted: 0, updated: 0, unchanged: 4 });
    expect((await db.query("SELECT id FROM material_items")).rows).toHaveLength(4);
    expect((await listMaterials(query, new URLSearchParams(), departments)).total).toBe(3);
  });
  it("更新收货字段保留已用完标记和 ID；同名新采购默认未用完，源缺失旧记录仍保留", async () => {
    await sync([row()]);
    await usage(admin, [1], "mark");
    const before = (await db.query<Record<string, unknown>>("SELECT * FROM material_items WHERE id=1")).rows[0];
    expect(await sync([row({ received_qty: 2, receipt_status: "全部收货", last_received_on: "2026-01-02" }), row({ request_no: "EXAMPLE-REQ-2" })]))
      .toMatchObject({ inserted: 1, updated: 1, unchanged: 0 });
    const after = (await db.query<Record<string, unknown>>("SELECT * FROM material_items WHERE id=1")).rows[0];
    expect(after).toMatchObject({ id: 1, is_used_up: true, used_up_by: 1, receipt_status: "全部收货" });
    expect(after.used_up_at).toEqual(before.used_up_at);
    expect((await db.query<Record<string, unknown>>("SELECT is_used_up FROM material_items WHERE request_no='EXAMPLE-REQ-2'")).rows[0].is_used_up).toBe(false);
    await sync([row({ request_no: "EXAMPLE-REQ-2" })]);
    expect((await db.query<Record<string, unknown>>("SELECT is_used_up FROM material_items WHERE id=1")).rows[0].is_used_up).toBe(true);
  });
  it("待审批申请、申请人及申请时间在同步中保持，不接受来源夹带的本地状态", async () => {
    await sync([row()]);
    await usage(member, [1], "mark");
    const before = (await db.query<Record<string, unknown>>("SELECT * FROM material_items WHERE id=1")).rows[0];
    await sync([{ ...row({ brand: "示例新品牌" }), is_used_up: true, used_up_requested_by: 999 } as MaterialRow]);
    const after = (await db.query<Record<string, unknown>>("SELECT * FROM material_items WHERE id=1")).rows[0];
    expect(after).toMatchObject({ is_used_up: false, used_up_requested_by: 2 });
    expect(after.used_up_requested_at).toEqual(before.used_up_requested_at);
  });
  it("重复组合及缺少采购单编码拒绝提交，失败事务不留批次或半成品", async () => {
    expect(() => validateMaterialKeys([row(), row()])).toThrow("第 1、2 条");
    expect(() => validateMaterialKeys([row({ request_no: "" })])).toThrow("缺少采购单编码");
    await expect(sync([row(), row()])).rejects.toThrow();
    expect((await db.query("SELECT * FROM import_batches")).rows).toHaveLength(0);
    await expect(transaction(async c => { await importMaterialRows(c, [row()], "example.csv", null); throw new Error("example rollback"); })).rejects.toThrow();
    expect((await db.query("SELECT * FROM material_items")).rows).toHaveLength(0);
    expect((await db.query("SELECT * FROM audit_logs")).rows).toHaveLength(0);
  });
  it("跨 200 行分批后重复导入不重复，源变更只更新变化记录", async () => {
    const rows = Array.from({ length: 205 }, (_, i) => row({ material_code: `EXAMPLE-${i}` }));
    expect(await sync(rows)).toMatchObject({ inserted: 205, updated: 0 });
    rows[204].receipt_status = "全部收货";
    expect(await sync(rows)).toMatchObject({ inserted: 0, updated: 1, unchanged: 204 });
  });
});

describe("已用完申请和审批", () => {
  it("成员申请经确认后仍在默认列表；重复申请不覆盖申请人；管理员批量批准后隐藏", async () => {
    expect(() => parseUsageAction({ action: "mark" }, "member")).toThrow("确认");
    expect(parseUsageAction({ action: "mark", confirmed: true }, "member")).toBe("mark");
    await sync([row(), row({ request_no: "EXAMPLE-REQ-2" })]);
    await usage(member, [1, 2], "mark");
    expect(await usage(otherMember, [1], "mark")).toMatchObject({ done: 0, skipped: 1 });
    expect((await db.query<Record<string, unknown>>("SELECT used_up_requested_by FROM material_items WHERE id=1")).rows[0].used_up_requested_by).toBe(2);
    const pending = await listUsageRequests(query, new URLSearchParams(), departments);
    expect(pending.total).toBe(2);
    expect((await listMaterials(query, new URLSearchParams(), departments)).total).toBe(2);
    expect(await usage(admin, [1, 2], "approve")).toMatchObject({ done: 2 });
    expect((await listMaterials(query, new URLSearchParams(), departments)).total).toBe(0);
    expect((await listMaterials(query, new URLSearchParams("used_up=1"), departments)).total).toBe(2);
    expect((await listUsageRequests(query, new URLSearchParams(), departments)).total).toBe(0);
  });
  it("普通成员不能恢复、批准或驳回；管理员可恢复和驳回", async () => {
    await sync([row()]);
    await usage(member, [1], "mark");
    for (const action of ["restore", "approve", "reject"] as const) {
      expect(() => parseUsageAction({ action, confirmed: true }, "member")).toThrow("管理员");
      await expect(usage(member, [1], action)).rejects.toMatchObject({ status: 403 });
    }
    await usage(admin, [1], "reject");
    expect((await db.query<Record<string, unknown>>("SELECT used_up_requested_at FROM material_items")).rows[0].used_up_requested_at).toBeNull();
    await usage(admin, [1], "mark");
    expect((await listMaterials(query, new URLSearchParams(), departments)).total).toBe(0);
    await usage(admin, [1], "restore");
    expect((await listMaterials(query, new URLSearchParams(), departments)).total).toBe(1);
    expect((await db.query("SELECT used_up_by,used_up_at,used_up_requested_by FROM material_items")).rows[0])
      .toMatchObject({ used_up_by: null, used_up_at: null, used_up_requested_by: null });
  });
  it("混入越出部门或不存在 ID 时整批拒绝，不处理其中有效记录", async () => {
    await sync([row(), row({ material_code: "EXAMPLE-M-2", department: "示例其他部门" })]);
    await expect(usage(admin, [1, 2], "mark")).rejects.toMatchObject({ status: 404 });
    expect((await db.query<Record<string, unknown>>("SELECT is_used_up FROM material_items WHERE id=1")).rows[0].is_used_up).toBe(false);
    expect(() => materialIds([1, "2"])).toThrow();
    expect(() => materialIds([])).toThrow();
    expect(() => materialIds(Array.from({ length: 501 }, (_, i) => i + 1))).toThrow();
  });
});

describe("部门和使用状态查询", () => {
  it("列表、候选、总数和分页按同一范围计算，空部门配置不展示全部部门", async () => {
    await sync([row(), row({ material_code: "EXAMPLE-M-2", brand: "示例已用完品牌", department: departments[1] }),
      row({ material_code: "EXAMPLE-M-3", brand: "示例隐藏品牌", department: "示例其他部门" })]);
    await usage(admin, [2], "mark");
    const normal = await listMaterials(query, new URLSearchParams("page=999"), departments);
    expect(normal).toMatchObject({ total: 1, page: 1 });
    expect(normal.facets.brand).toEqual(["示例品牌"]);
    const used = await listMaterials(query, new URLSearchParams("used_up=1"), departments);
    expect(used.facets.brand).toEqual(["示例已用完品牌"]);
    expect((await listMaterials(query, new URLSearchParams("q=隐藏品牌"), departments)).total).toBe(0);
    expect((await listMaterials(query, new URLSearchParams(), [])).total).toBe(0);
    expect(displayDepartments('[" 示例部门甲 ","示例部门甲","示例部门乙"]')).toEqual(departments);
    expect(() => displayDepartments("broken")).toThrow();
  });
});
