import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./http";
import { MaterialError } from "./materials-data";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), transaction: vi.fn(), query: vi.fn(), listStock: vi.fn(), create: vi.fn(), update: vi.fn(),
  check: vi.fn(), remove: vi.fn(), sync: vi.fn(), checks: vi.fn(), templates: vi.fn(), links: vi.fn(), decide: vi.fn(),
}));
vi.mock("./auth", () => ({ requireUser: mocks.user }));
vi.mock("./db", () => ({ query: mocks.query, withTransaction: mocks.transaction, pool: { query: mocks.query } }));
vi.mock("./consumable-stock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./consumable-stock")>();
  return {
    ...actual,
    listStock: mocks.listStock, createStockItem: mocks.create, updateStockItem: mocks.update,
    checkStock: mocks.check, deleteStockItem: mocks.remove, matchPurchases: mocks.sync, listChecks: mocks.checks,
    initSlotTemplates: mocks.templates, listLinks: mocks.links, decideLink: mocks.decide,
  };
});
import { GET as getStock, POST as createStock } from "../app/api/v1/materials/stock/route";
import { PATCH as patchStock, DELETE as removeStock } from "../app/api/v1/materials/stock/[id]/route";
import { POST as checkStock } from "../app/api/v1/materials/stock/[id]/check/route";
import { GET as getChecks } from "../app/api/v1/materials/stock/[id]/checks/route";
import { POST as syncStock } from "../app/api/v1/materials/stock/sync/route";
import { POST as initTemplates } from "../app/api/v1/materials/stock/templates/route";
import { GET as getLinks } from "../app/api/v1/materials/stock/links/route";
import { POST as decideLink } from "../app/api/v1/materials/stock/links/[id]/route";

const context = (id = "1") => ({ params: Promise.resolve({ id }) });
const url = (path: string) => `http://localhost${path}`;
const post = (path: string, body?: unknown) =>
  new Request(url(path), { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patch = (path: string, body?: unknown) =>
  new Request(url(path), { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => fn({ query: mocks.query }));
  delete process.env.MATERIAL_STOCK_CATEGORIES_JSON;
});
afterEach(() => { delete process.env.MATERIAL_STOCK_CATEGORIES_JSON; });

describe("常用耗材库存入口权限", () => {
  it("未登录不能查看或写入库存", async () => {
    mocks.user.mockRejectedValue(new HttpError(401, "请先登录"));
    expect((await getStock(new Request(url("/api/v1/materials/stock")))).status).toBe(401);
    expect((await checkStock(post("/api/v1/materials/stock/1/check", { quantity: 1 }), context())).status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("普通成员可查看列表和核对历史，但不能新增、编辑、核对、删除或同步", async () => {
    mocks.user.mockImplementation((role?: string) => {
      if (role === "admin") throw new HttpError(403, "需要管理员权限");
      return { id: 2, role: "member" };
    });
    mocks.listStock.mockResolvedValue({ categories: [], items: [], summary: {}, stale_days: 30 });
    mocks.checks.mockResolvedValue([]);
    expect((await getStock(new Request(url("/api/v1/materials/stock?category=吸头")))).status).toBe(200);
    expect((await getChecks(new Request(url("/api/v1/materials/stock/7/checks?limit=5")), context("7"))).status).toBe(200);
    expect(mocks.checks).toHaveBeenCalledWith(expect.anything(), 7, 5);
    const calls = [
      createStock(post("/api/v1/materials/stock", {})),
      patchStock(patch("/api/v1/materials/stock/1", { note: "x" }), context()),
      removeStock(new Request(url("/api/v1/materials/stock/1"), { method: "DELETE" }), context()),
      checkStock(post("/api/v1/materials/stock/1/check", { quantity: 1 }), context()),
      syncStock(post("/api/v1/materials/stock/sync")),
      initTemplates(post("/api/v1/materials/stock/templates")),
      getLinks(new Request(url("/api/v1/materials/stock/links"))),
      decideLink(post("/api/v1/materials/stock/links/1", { action: "exclude" }), context()),
    ];
    for (const response of await Promise.all(calls)) expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.links).not.toHaveBeenCalled();
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it("管理员可新增、编辑、核对、删除、建模板、匹配采购和处理核对工作台", async () => {
    mocks.user.mockResolvedValue({ id: 1, role: "admin" });
    mocks.create.mockResolvedValue({ id: 1 });
    mocks.update.mockResolvedValue({ id: 1 });
    mocks.check.mockResolvedValue({ id: 1, quantity: 2 });
    mocks.remove.mockResolvedValue({ deleted: 1 });
    mocks.sync.mockResolvedValue({ scanned: 3, suggested: 1, known: 0, excluded: 0, unmatched: 2 });
    mocks.templates.mockResolvedValue({ templates: 58, created: 58, skipped: 0 });
    mocks.links.mockResolvedValue({ view: "pending", items: [], counts: { pending: 0, inbound: 0 }, slots: [] });
    mocks.decide.mockResolvedValue({ updated: 1 });
    expect((await createStock(post("/api/v1/materials/stock", { item_name: "示例吸头" }))).status).toBe(201);
    expect((await patchStock(patch("/api/v1/materials/stock/1", { note: "x" }), context())).status).toBe(200);
    expect((await checkStock(post("/api/v1/materials/stock/1/check", { quantity: 2 }), context())).status).toBe(200);
    expect((await removeStock(new Request(url("/api/v1/materials/stock/1"), { method: "DELETE" }), context())).status).toBe(200);
    expect((await syncStock(post("/api/v1/materials/stock/sync"))).status).toBe(200);
    expect((await initTemplates(post("/api/v1/materials/stock/templates"))).status).toBe(200);
    expect((await getLinks(new Request(url("/api/v1/materials/stock/links?view=inbound")))).status).toBe(200);
    expect((await decideLink(post("/api/v1/materials/stock/links/9", { action: "stock", quantity: 2 }), context("9"))).status).toBe(200);
    expect((await decideLink(post("/api/v1/materials/stock/links/x", { action: "stock" }), context("x"))).status).toBe(400);
    expect(mocks.transaction).toHaveBeenCalledTimes(7);
    expect(mocks.links.mock.calls[0][1].get("view")).toBe("inbound");
    expect(mocks.decide.mock.calls[0].slice(1, 3)).toEqual([9, { action: "stock", quantity: 2 }]);
    expect(mocks.create.mock.calls[0][1]).toMatchObject({ item_name: "示例吸头" });
    expect(mocks.check.mock.calls[0][1]).toBe(1);
  });
});

describe("常用耗材库存参数与错误映射", () => {
  it("编号非法或请求体不是 JSON 时不进入写事务", async () => {
    mocks.user.mockResolvedValue({ id: 1, role: "admin" });
    expect((await checkStock(post("/api/v1/materials/stock/abc/check", { quantity: 1 }), context("abc"))).status).toBe(400);
    expect((await patchStock(patch("/api/v1/materials/stock/0", { note: "x" }), context("0"))).status).toBe(400);
    expect((await createStock(post("/api/v1/materials/stock", undefined))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("业务错误按状态码返回，数据库异常只返回通用提示", async () => {
    mocks.user.mockResolvedValue({ id: 1, role: "admin" });
    mocks.check.mockRejectedValueOnce(new MaterialError("库存刚刚被其他人更新，请刷新后重新核对", 409));
    const conflict = await checkStock(post("/api/v1/materials/stock/1/check", { quantity: 3 }), context());
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: "库存刚刚被其他人更新，请刷新后重新核对" });
    mocks.check.mockRejectedValueOnce(new Error("example-private-database-value"));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const broken = await checkStock(post("/api/v1/materials/stock/1/check", { quantity: 3 }), context());
      expect(broken.status).toBe(500);
      expect(await broken.text()).not.toContain("example-private-database-value");
      expect(logger).toHaveBeenCalledWith("物料操作失败");
    } finally { logger.mockRestore(); }
  });
  it("类别配置损坏时列表返回 503", async () => {
    process.env.MATERIAL_STOCK_CATEGORIES_JSON = "broken";
    mocks.user.mockResolvedValue({ id: 2, role: "member" });
    const response = await getStock(new Request(url("/api/v1/materials/stock")));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "常用耗材类别配置无效，请联系管理员" });
    expect(mocks.listStock).not.toHaveBeenCalled();
  });
});
