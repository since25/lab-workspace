import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./http";

const mocks = vi.hoisted(() => ({ user: vi.fn(), transaction: vi.fn(), query: vi.fn() }));
vi.mock("./auth", () => ({ requireUser: mocks.user }));
vi.mock("./db", () => ({ withTransaction: mocks.transaction, query: mocks.query, pool: { query: mocks.query } }));
import { GET as getMaterials } from "../app/api/v1/materials/route";
import { POST as usage } from "../app/api/v1/materials/[id]/usage/route";
import { GET as getQueue, POST as reviewQueue } from "../app/api/v1/admin/materials/usage-requests/route";
import { POST as importMaterials } from "../app/api/v1/materials/import/route";
import { purchaseInfo } from "./materials-copy";

const context = { params: Promise.resolve({ id: "1" }) };
const request = (body: unknown) => new Request("http://localhost/api/v1/materials/1/usage", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); });

describe("物料入口权限", () => {
  it("未登录不能查询列表或提交申请", async () => {
    mocks.user.mockRejectedValue(new HttpError(401, "请先登录"));
    expect((await getMaterials(new Request("http://localhost/api/v1/materials"))).status).toBe(401);
    expect((await usage(request({ action: "mark", confirmed: true }), context)).status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("成员未确认的申请及伪造恢复/批准/驳回均不进入写事务", async () => {
    mocks.user.mockResolvedValue({ id: 2, role: "member" });
    expect((await usage(request({ action: "mark" }), context)).status).toBe(400);
    for (const action of ["restore", "approve", "reject"]) {
      expect((await usage(request({ action, confirmed: true }), context)).status).toBe(403);
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("后台审批队列和批量审批、导入始终要求管理员", async () => {
    mocks.user.mockImplementation((role?: string) => {
      if (role === "admin") throw new HttpError(403, "需要管理员权限");
      return { id: 2, role: "member" };
    });
    expect((await getQueue(new Request("http://localhost/api/v1/admin/materials/usage-requests"))).status).toBe(403);
    expect((await reviewQueue(request({ action: "approve", ids: [1] }))).status).toBe(403);
    expect((await importMaterials(request({}))).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("数据库异常中的业务内容不写入响应或日志", async () => {
    mocks.user.mockResolvedValue({ id: 1, role: "admin" });
    mocks.transaction.mockRejectedValue(new Error("example-private-database-value"));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await usage(request({ action: "mark" }), context);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("example-private-database-value");
      expect(logger).toHaveBeenCalledWith("物料操作失败");
    } finally { logger.mockRestore(); }
  });
  it("复制内容只包含再次采购需要的信息，不带已用完或审批状态", () => {
    expect(purchaseInfo({ item_name: "示例耗材", brand: "示例品牌", spec_model: "EXAMPLE", unit: "盒", quantity: 2, project_code: "EXAMPLE-PRJ", remarks: "" }))
      .toBe("名称：示例耗材\n品牌：示例品牌\n规格型号：EXAMPLE\n单位：盒\n数量：2\n使用项目：EXAMPLE-PRJ\n备注：");
  });
});
