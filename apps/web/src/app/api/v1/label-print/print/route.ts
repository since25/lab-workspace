import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { query } from "@/lib/db";
import { handle, HttpError, ok, readJson, str } from "@/lib/http";
import { callLabelPrint, listPrinters, requireLabelPrinting } from "@/lib/label-print";
import { getSourceItems, labelRows, parseCopies, parseItemIds, parseSource, parseSourceFields, parseTemplate } from "@/lib/label-sources";

export const POST = handle(async (req: Request) => {
  const user = requireLabelPrinting(await requireUser());
  const body = await readJson(req);
  const requestId = str(body.request_id);
  if (!requestId || requestId.length > 100) throw new HttpError(400, "打印请求编号无效");
  const source = parseSource(body.source);
  const template = parseTemplate(body.template);
  const fields = parseSourceFields(source, body.fields);
  const ids = parseItemIds(body.ids);
  const copies = parseCopies(body.copies);
  const printerId = Number(body.printer_id);
  if (!Number.isSafeInteger(printerId) || printerId <= 0) throw new HttpError(400, "请选择打印机");
  const [printer] = await listPrinters(query, true).then((rows) => rows.filter((p) => p.id === printerId && p.enabled));
  if (!printer) throw new HttpError(400, "打印机不存在或已停用，请刷新后重试");
  const items = await getSourceItems(query, source, ids);
  const rows = labelRows(items, source, fields);
  try {
    await query(
      `INSERT INTO label_print_jobs(request_id, user_id, printer_key, template, fields, row_count, status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
      [requestId, user.id, printer.printer_key, `${source}:${template}`, JSON.stringify(fields), rows.length],
    );
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "这批打印请求已经提交，请勿重复操作");
    throw e;
  }
  try {
    const result = await callLabelPrint("/api/print", {
      rows,
      layout: "two-up",
      template,
      printer_id: printer.printer_key,
      copies,
      operator: user.display_name,
    });
    await query("UPDATE label_print_jobs SET status='sent', result=$2, updated_at=now() WHERE request_id=$1", [requestId, JSON.stringify(result)]);
    await audit(user.id, "label_print.sent", "label_print_job", requestId, { printer: printer.name, row_count: rows.length, copies, source, template, fields }, req);
    return ok({ ...result, request_id: requestId, printer: printer.name, count: rows.length, copies, source, template });
  } catch (e) {
    await query("UPDATE label_print_jobs SET status='failed', result=$2, updated_at=now() WHERE request_id=$1", [requestId, JSON.stringify({ error: e instanceof Error ? e.message : String(e) })]);
    throw e;
  }
});
