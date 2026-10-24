import { requireUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { handle, HttpError, ok, readJson, str } from "@/lib/http";
import { requireLabelPrinting } from "@/lib/label-print";
import { listCustomBatches, parseAndSaveCustomCsv } from "@/lib/label-custom-csv";

export const GET = handle(async () => {
  const user = requireLabelPrinting(await requireUser());
  const batches = await listCustomBatches(query, user);
  return ok({ batches });
});

export const POST = handle(async (req: Request) => {
  const user = requireLabelPrinting(await requireUser());
  const body = await readJson(req);
  const csvText = str(body.csv_text);
  if (!csvText) throw new HttpError(400, "请提供 CSV 文件内容");
  const batchName = str(body.batch_name) || "自定义批次";

  const batch = await withTransaction(async (client) => {
    return parseAndSaveCustomCsv(client, user, batchName, csvText);
  });

  return ok({ batch }, 201);
});
