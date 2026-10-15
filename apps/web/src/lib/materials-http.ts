import { handle, HttpError } from "./http";
import { MaterialError } from "./materials-data";

export function materialHandle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return handle(async (...args: A) => {
    try { return await fn(...args); }
    catch (e) {
      if (e instanceof MaterialError) throw new HttpError(e.status, e.message);
      if (e instanceof HttpError) throw e;
      // 数据库异常可能附带采购字段值，不将原始异常写入通用日志。
      console.error("物料操作失败");
      throw new HttpError(500, "物料操作失败，请联系管理员");
    }
  });
}
