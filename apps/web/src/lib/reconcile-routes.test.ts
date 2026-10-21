import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./http";
import { MaterialError } from "./materials-data";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), transaction: vi.fn(), query: vi.fn(), list: vi.fn(), create: vi.fn(), search: vi.fn(),
  get: vi.fn(), review: vi.fn(), departments: vi.fn(),
}));
vi.mock("./auth", () => ({ requireUser: mocks.user }));
vi.mock("./db", () => ({ query: mocks.query, withTransaction: mocks.transaction, pool: { query: mocks.query } }));
vi.mock("./materials-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./materials-data")>();
  return { ...actual, displayDepartments: mocks.departments };
});
vi.mock("./stock-reconcile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stock-reconcile")>();
  return {
    ...actual, listReconcileRequests: mocks.list, createReconcileRequest: mocks.create,
    searchReconcileContext: mocks.search, getReconcileRequest: mocks.get, reviewReconcileRequests: mocks.review,
  };
});
import { GET as getList, POST as submit } from "../app/api/v1/materials/reconcile/route";
import { GET as search } from "../app/api/v1/materials/reconcile/search/route";
import { GET as getOne } from "../app/api/v1/materials/reconcile/[id]/route";
import { GET as adminList, POST as adminReview } from "../app/api/v1/admin/materials/reconcile/route";

const url = (path: string) => `http://localhost${path}`;
const post = (path: string, body?: unknown) => new Request(url(path), {
  method: "POST", body: body === undefined ? undefined : JSON.stringify(body),
});
const context = (id = "1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => fn({ query: mocks.query }));
  mocks.departments.mockReturnValue(["示例部门甲"]);
});

describe("库存校对 API 权限", () => {
  it("未登录不能查询或提交", async () => {
    mocks.user.mockRejectedValue(new HttpError(401, "请先登录"));
    expect((await getList(new Request(url("/api/v1/materials/reconcile")))).status).toBe(401);
    expect((await search(new Request(url("/api/v1/materials/reconcile/search?q=24孔板")))).status).toBe(401);
    expect((await submit(post("/api/v1/materials/reconcile", { confirmed: true }))).status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("成员可查询、提交和查看自己的请求，但不能进入管理员列表或审批", async () => {
    mocks.user.mockImplementation((role?: string) => {
      if (role === "admin") throw new HttpError(403, "需要管理员权限");
      return { id: 2, role: "member" };
    });
    mocks.list.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 50 });
    mocks.search.mockResolvedValue({ query: "24孔板", stock_items: [], purchase_records: [], summary: {} });
    mocks.get.mockResolvedValue({ id: 3 });
    mocks.create.mockResolvedValue({ id: 4 });
    expect((await getList(new Request(url("/api/v1/materials/reconcile")))).status).toBe(200);
    expect((await search(new Request(url("/api/v1/materials/reconcile/search?q=24孔板&months=2")))).status).toBe(200);
    expect((await getOne(new Request(url("/api/v1/materials/reconcile/3")), context("3"))).status).toBe(200);
    expect((await submit(post("/api/v1/materials/reconcile", { confirmed: true, note: "x" }))).status).toBe(201);
    expect((await adminList(new Request(url("/api/v1/admin/materials/reconcile")))).status).toBe(403);
    expect((await adminReview(post("/api/v1/admin/materials/reconcile", { ids: [1], action: "approve" }))).status).toBe(403);
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("管理员可查看全部并审批，审批参数原样传入事务", async () => {
    mocks.user.mockResolvedValue({ id: 1, role: "admin" });
    mocks.list.mockResolvedValue({ items: [], total: 0 });
    mocks.review.mockResolvedValue({ approved: 1, rejected: 0, skipped: 0 });
    expect((await adminList(new Request(url("/api/v1/admin/materials/reconcile?status=pending")))).status).toBe(200);
    const response = await adminReview(post("/api/v1/admin/materials/reconcile", { ids: [7], action: "approve", note: "同意" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ approved: 1 });
    expect(mocks.review.mock.calls[0].slice(1, 5)).toEqual([[7], "approve", { id: 1, role: "admin" }, "同意"]);
  });
});

describe("库存校对 API 参数与错误", () => {
  it("编号非法或缺少 JSON 时不进入事务", async () => {
    mocks.user.mockResolvedValue({ id: 1, role: "admin" });
    expect((await getOne(new Request(url("/api/v1/materials/reconcile/abc")), context("abc"))).status).toBe(400);
    expect((await submit(post("/api/v1/materials/reconcile", undefined))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("业务冲突按状态码返回，数据库异常不泄露内容", async () => {
    mocks.user.mockResolvedValue({ id: 1, role: "admin" });
    mocks.review.mockRejectedValueOnce(new MaterialError("「示例耗材」库存已变化，请驳回后让提交人重新核对", 409));
    const conflict = await adminReview(post("/api/v1/admin/materials/reconcile", { ids: [1], action: "approve" }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: expect.stringContaining("库存已变化") });
    mocks.review.mockRejectedValueOnce(new Error("example-private-database-value"));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const broken = await adminReview(post("/api/v1/admin/materials/reconcile", { ids: [1], action: "approve" }));
      expect(broken.status).toBe(500);
      expect(await broken.text()).not.toContain("example-private-database-value");
      expect(logger).toHaveBeenCalledWith("物料操作失败");
    } finally { logger.mockRestore(); }
  });
  it("检索把部门、类别和参数传给 service", async () => {
    mocks.user.mockResolvedValue({ id: 2, role: "member" });
    mocks.search.mockResolvedValue({ query: "24孔板" });
    await search(new Request(url("/api/v1/materials/reconcile/search?q=24孔板&months=3")));
    const [dbArg, spArg, categories, departments] = mocks.search.mock.calls[0];
    expect(dbArg).toBe(mocks.query);
    expect(spArg.get("months")).toBe("3");
    expect(categories.map((c: { name: string }) => c.name)).toContain("塑料耗材/培养板皿");
    expect(departments).toEqual(["示例部门甲"]);
  });
});
