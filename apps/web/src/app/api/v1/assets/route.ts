import { requireUser } from "@/lib/auth";
import { assetDisplayDepartments, assetMeta, assetView, listAssetGroupItems, listAssetGroups, listAssetItems } from "@/lib/assets-list";
import { query } from "@/lib/db";
import { handle, ok } from "@/lib/http";

// 固定资产查询：默认返回「名称＋规格型号＋使用部门」汇总视图，view=item 返回逐条明细，view=detail 展开某个分组。
// 台账全量入库，能看哪些部门由 ASSET_DISPLAY_DEPARTMENTS_JSON 决定，其余靠参数筛选。
export const GET = handle(async (req: Request) => {
  await requireUser();
  const sp = new URL(req.url).searchParams;
  const scope = assetDisplayDepartments();
  const view = assetView(sp);
  if (view === "detail") return ok({ view, ...(await listAssetGroupItems(query, sp, scope)) });
  const list = view === "item" ? await listAssetItems(query, sp, scope) : await listAssetGroups(query, sp, scope);
  return ok({ view, ...list, ...(await assetMeta(query, scope)) });
});
