import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, HttpError, ok, readJson, str } from "@/lib/http";
import { requireLabelPrinting } from "@/lib/label-print";
import { updateCustomItemCell } from "@/lib/label-custom-csv";

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = requireLabelPrinting(await requireUser());
  const { id } = await ctx.params;
  const itemId = Number(id);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) throw new HttpError(400, "缺少有效记录 id");

  const body = await readJson(req);
  const field = str(body.field);
  if (!field) throw new HttpError(400, "缺少字段名称 field");
  const value = String(body.value ?? "");

  const updated = await updateCustomItemCell(query, itemId, field, value, user);
  return ok({ item: updated });
});
