import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import { stockCategories } from "./consumables";
import { checkStock, createStockItem } from "./consumable-stock";
import type { MaterialQuery } from "./materials-list";
import {
  createReconcileRequest, getReconcileRequest, listReconcileRequests, reviewReconcileRequests, searchReconcileContext,
} from "./stock-reconcile";

const db = new PGlite();
const admin = { id: 1, role: "admin" };
const member = { id: 2, role: "member" };
const other = { id: 3, role: "member" };
const departments = ["示例部门甲", "示例部门乙"];
const categories = stockCategories("");
const now = Date.parse("2026-10-20T00:00:00Z");
const query: MaterialQuery = async <T,>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params)).rows;
const transaction = <T>(fn: (c: PoolClient) => Promise<T>) => db.transaction((c) => fn(c as unknown as PoolClient));
let materialSeq = 0;
const stock = (changes: Record<string, unknown> = {}) => transaction((c) => createStockItem(c, {
  category: "细胞培养板", item_name: "24 孔板", brand: "示例品牌", spec_model: "EXAMPLE-24W", unit: "箱",
  quantity: 2, safety_stock: 3, note: "细胞房第二层", ...changes,
}, admin, categories));
const material = async (changes: Record<string, unknown> = {}) => {
  materialSeq += 1;
  return (await db.query<{ id: number }>(
  `INSERT INTO material_items(request_no, material_code, department, status, item_name, brand, spec_model, unit,
     requested_on, last_received_on, receipt_status, purchased_qty, received_qty, is_used_up, used_up_requested_at)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
  [changes.request_no ?? `EXAMPLE-REQ-${materialSeq}`, changes.material_code ?? `EXAMPLE-M-${materialSeq}`, changes.department ?? departments[0],
    changes.status ?? "启用", changes.item_name ?? "24 孔板", changes.brand ?? "示例品牌",
    changes.spec_model ?? "EXAMPLE-24W", changes.unit ?? "箱", changes.requested_on ?? "2026-09-01",
    changes.last_received_on ?? null, changes.receipt_status ?? "未收货", changes.purchased_qty ?? 2,
    changes.received_qty ?? 0, changes.is_used_up ?? false, changes.used_up_requested_at ?? null]
  )).rows[0].id;
};

beforeAll(async () => {
  await db.exec(await readFile(new URL("../../../../db/migrations/001_init.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../../db/migrations/009_material_usage.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../../db/migrations/011_consumable_stock.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../../db/migrations/012_stock_reconcile.sql", import.meta.url), "utf8"));
  await db.exec("INSERT INTO users(id,username,display_name,password_hash,role) VALUES (1,'example-admin','示例管理员','example-hash','admin'),(2,'example-member','示例成员','example-hash','member'),(3,'example-member-2','示例成员乙','example-hash','member')");
}, 30000);
beforeEach(async () => {
  await db.exec("TRUNCATE stock_reconcile_requests, consumable_stock, consumable_stock_checks, material_items, audit_logs RESTART IDENTITY CASCADE");
});
afterAll(() => db.close());

describe("库存校对上下文检索", () => {
  it("按去空格名称匹配库存与采购记录，标出近月未收货、已用完和待审批", async () => {
    const item = await stock();
    const recentUnreceived = await material({ request_no: "EXAMPLE-REQ-1" });
    const recentReceived = await material({ request_no: "EXAMPLE-REQ-2", requested_on: "2026-09-02", receipt_status: "全部收货", last_received_on: "2026-09-10", received_qty: 2 });
    const old = await material({ request_no: "EXAMPLE-REQ-3", requested_on: "2026-06-01", receipt_status: "全部收货", last_received_on: "2026-06-10", received_qty: 2 });
    const pending = await material({ request_no: "EXAMPLE-REQ-4", used_up_requested_at: "2026-10-01T00:00:00Z" });
    const usedUp = await material({ request_no: "EXAMPLE-REQ-5", is_used_up: true, requested_on: "2026-06-01", receipt_status: "全部收货", last_received_on: "2026-06-10", received_qty: 2 });
    await material({ request_no: "EXAMPLE-REQ-6", department: "示例其他部门" });
    const result = await searchReconcileContext(query, new URLSearchParams("q=24孔板&months=2"), categories, departments, now);
    expect(result.stock_items).toHaveLength(1);
    expect(result.stock_items[0]).toMatchObject({ id: item.id, quantity: 2, status: "low", status_text: "低于安全库存" });
    const byId = new Map(result.purchase_records.map((r) => [r.id, r]));
    expect(result.purchase_records).toHaveLength(5);
    expect(byId.get(recentUnreceived)).toMatchObject({ recent: true, unreceived: true, received: false, partial: false });
    expect(byId.get(recentReceived)).toMatchObject({ recent: true, unreceived: false, received: true });
    expect(byId.get(old)).toMatchObject({ recent: false, received: true });
    expect(byId.get(pending)).toMatchObject({ is_used_up: false, used_up_requested_at: "2026-10-01T00:00:00.000Z" });
    expect(byId.get(usedUp)).toMatchObject({ is_used_up: true });
    expect(result.summary).toMatchObject({
      stock_match_count: 1, purchase_count: 5, active_purchase_count: 4,
      recent_purchase_count: 3, recent_unreceived_count: 2, pending_used_up_count: 1, used_up_count: 1,
    });
    expect([...result.summary.suggested_material_ids].sort((a, b) => a - b)).toEqual([recentUnreceived, recentReceived, old].sort((a, b) => a - b));
    expect(result.summary.pending_material_ids).toEqual([pending]);
    expect(result.cutoff).toBe("2026-08-20");
  });

  it("缺少关键词或超出范围时拒绝", async () => {
    await expect(searchReconcileContext(query, new URLSearchParams(), categories, departments, now)).rejects.toThrow("耗材名称");
    await expect(searchReconcileContext(query, new URLSearchParams("q="), categories, departments, now)).rejects.toThrow("耗材名称");
  });
});

const submit = (changes: Record<string, unknown> = {}, user = member) => transaction((c) => createReconcileRequest(c, {
  stock_id: 1, proposed_quantity: 0, material_ids: [], note: "24 孔板已用完", confirmed: true, ...changes,
}, user, departments));

describe("提交库存校对请求", () => {
  it("提交后只生成待审批请求，库存和采购标记不变", async () => {
    const item = await stock();
    const materialId = await material();
    const request = await submit({ material_ids: [materialId] });
    expect(request).toMatchObject({
      stock_id: item.id, stock_label: "细胞培养板 · 24 孔板 · 示例品牌 · EXAMPLE-24W",
      stock_before: 2, stock_revision: 0, proposed_quantity: 0, status: "pending",
      requested_by_name: "示例成员", materials: [{ id: materialId }],
    });
    expect(Number((await db.query<{ quantity: string }>("SELECT quantity FROM consumable_stock WHERE id=$1", [item.id])).rows[0].quantity)).toBe(2);
    expect((await db.query<{ is_used_up: boolean }>("SELECT is_used_up FROM material_items WHERE id=$1", [materialId])).rows[0].is_used_up).toBe(false);
    expect((await db.query("SELECT * FROM consumable_stock_checks")).rows).toHaveLength(1);
    expect((await db.query<{ action: string }>("SELECT action FROM audit_logs ORDER BY id")).rows.map((r) => r.action)).toContain("material.reconcile_submit");
  });

  it("必须确认、填写说明并指定目标；采购记录必须在展示部门内", async () => {
    const item = await stock();
    await material();
    await expect(submit({ confirmed: false })).rejects.toThrow("确认");
    await expect(submit({ note: "  " })).rejects.toThrow("说明");
    await expect(submit({ stock_id: null, proposed_quantity: null, material_ids: [] })).rejects.toThrow("至少");
    await expect(submit({ stock_id: null })).rejects.toThrow("至少");
    await expect(submit({ stock_id: null, proposed_quantity: 1, material_ids: [] })).rejects.toThrow("至少");
    await expect(submit({ proposed_quantity: null, stock_id: item.id, material_ids: [] })).resolves.toMatchObject({ proposed_quantity: null });
    const outside = await material({ department: "示例其他部门" });
    await expect(submit({ material_ids: [outside] })).rejects.toMatchObject({ status: 404 });
  });

  it("同一耗材已有待审批请求时拒绝第二条", async () => {
    await stock();
    await submit();
    await expect(submit({ note: "再次提交" })).rejects.toMatchObject({ status: 409 });
  });

  it("未关联采购记录时也允许只改库存，材料列表为空", async () => {
    await stock();
    const request = await submit();
    expect(request.materials).toEqual([]);
    expect(request.material_ids).toEqual([]);
  });
});

describe("管理员审批", () => {
  it("批准后同时改库存、写核对历史、标记采购记录并清理待审批字段", async () => {
    const item = await stock();
    const materialId = await material();
    const request = await submit({ material_ids: [materialId] }, member);
    expect(await transaction((c) => reviewReconcileRequests(c, [request.id], "approve", admin, "同意"))).toMatchObject({ approved: 1, skipped: 0 });
    expect(Number((await db.query<{ quantity: string }>("SELECT quantity FROM consumable_stock WHERE id=$1", [item.id])).rows[0].quantity)).toBe(0);
    const check = (await db.query<{ before_qty: string; after_qty: string; note: string; checked_by: number }>("SELECT before_qty, after_qty, note, checked_by FROM consumable_stock_checks ORDER BY id DESC")).rows[0];
    expect(check).toMatchObject({ before_qty: "2.00", after_qty: "0.00", checked_by: 1 });
    expect(check.note).toContain("库存校对请求");
    const row = (await db.query<{ is_used_up: boolean; used_up_by: number; used_up_requested_at: Date | null; used_up_requested_by: number | null }>(
      "SELECT is_used_up, used_up_by, used_up_requested_at, used_up_requested_by FROM material_items WHERE id=$1", [materialId]
    )).rows[0];
    expect(row).toMatchObject({ is_used_up: true, used_up_by: 1, used_up_requested_at: null, used_up_requested_by: null });
    const reviewed = (await db.query<{ status: string; reviewed_by: number; review_note: string }>("SELECT status, reviewed_by, review_note FROM stock_reconcile_requests WHERE id=$1", [request.id])).rows[0];
    expect(reviewed).toMatchObject({ status: "approved", reviewed_by: 1, review_note: "同意" });
    const actions = (await db.query<{ action: string }>("SELECT action FROM audit_logs ORDER BY id")).rows.map((r) => r.action);
    expect(actions).toContain("material_stock.reconcile_approve");
    expect(actions).toContain("material.reconcile_approve");
  });

  it("库存 revision 在提交后变化时整批拒绝，不覆盖新数量或采购标记", async () => {
    const item = await stock();
    const materialId = await material();
    const request = await submit({ material_ids: [materialId] }, member);
    await transaction((c) => checkStock(c, item.id, { quantity: 5, note: "管理员先核对" }, admin));
    await expect(transaction((c) => reviewReconcileRequests(c, [request.id], "approve", admin, "")))
      .rejects.toMatchObject({ status: 409 });
    expect(Number((await db.query<{ quantity: string }>("SELECT quantity FROM consumable_stock WHERE id=$1", [item.id])).rows[0].quantity)).toBe(5);
    expect((await db.query<{ is_used_up: boolean }>("SELECT is_used_up FROM material_items WHERE id=$1", [materialId])).rows[0].is_used_up).toBe(false);
    expect((await db.query<{ status: string }>("SELECT status FROM stock_reconcile_requests WHERE id=$1", [request.id])).rows[0].status).toBe("pending");
  });

  it("驳回只改请求状态；已处理请求再操作时跳过", async () => {
    await stock();
    const request = await submit();
    expect(await transaction((c) => reviewReconcileRequests(c, [request.id], "reject", admin, "数量不对")))
      .toMatchObject({ approved: 0, rejected: 1, skipped: 0 });
    const row = (await db.query<{ status: string; review_note: string }>("SELECT status, review_note FROM stock_reconcile_requests WHERE id=$1", [request.id])).rows[0];
    expect(row).toMatchObject({ status: "rejected", review_note: "数量不对" });
    expect(Number((await db.query<{ quantity: string }>("SELECT quantity FROM consumable_stock")).rows[0].quantity)).toBe(2);
    expect(await transaction((c) => reviewReconcileRequests(c, [request.id], "approve", admin, ""))).toMatchObject({ approved: 0, skipped: 1 });
    await expect(transaction((c) => reviewReconcileRequests(c, [999], "approve", admin, ""))).rejects.toMatchObject({ status: 404 });
    await expect(transaction((c) => reviewReconcileRequests(c, [request.id], "other", admin, ""))).rejects.toThrow("批准或驳回");
  });
});

describe("请求列表与权限", () => {
  it("成员只看自己的请求，管理员看全部；详情跨账号返回 404", async () => {
    await stock();
    await stock({ item_name: "6 孔板", spec_model: "EXAMPLE-6W" });
    const own = await submit({}, member);
    const otherRequest = await submit({ stock_id: 2 }, other);
    const mine = await listReconcileRequests(query, new URLSearchParams("status=all"), member);
    expect(mine.items.map((r) => r.id)).toEqual([own.id]);
    const all = await listReconcileRequests(query, new URLSearchParams("status=pending"), admin);
    expect(all.items.map((r) => r.id)).toEqual([otherRequest.id, own.id]);
    expect((await getReconcileRequest(query, own.id, member)).id).toBe(own.id);
    await expect(getReconcileRequest(query, own.id, other)).rejects.toMatchObject({ status: 404 });
    await expect(listReconcileRequests(query, new URLSearchParams("status=unknown"), admin)).rejects.toThrow("未知的请求状态");
  });

  it("库存被改动后列表标出 stock_changed，提示审批前重新核对", async () => {
    const item = await stock();
    const request = await submit();
    await transaction((c) => checkStock(c, item.id, { quantity: 1 }, admin));
    const list = await listReconcileRequests(query, new URLSearchParams("status=pending"), admin);
    expect(list.items[0]).toMatchObject({ id: request.id, stock_changed: true, stock_before: 2, current_quantity: 1, current_revision: 1 });
  });
});
