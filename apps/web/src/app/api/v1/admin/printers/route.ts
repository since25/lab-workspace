import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, HttpError, ok, readJson, str } from "@/lib/http";
import { listPrinters, type Printer } from "@/lib/label-print";

export const GET = handle(async () => { await requireUser("admin"); return ok({ printers: await listPrinters(query, true) }); });

export const POST = handle(async (req: Request) => {
  const admin = await requireUser("admin");
  const body = await readJson(req);
  const printer_key = str(body.printer_key);
  const name = str(body.name);
  if (!/^[^\u0000-\u001f]{2,120}$/.test(printer_key) || !name || name.length > 120) throw new HttpError(400, "请填写有效的打印机标识和名称");
  try {
    if (body.is_default === true) await query("UPDATE label_printers SET is_default=false, updated_at=now()");
    const [printer] = await query<Printer>("INSERT INTO label_printers(printer_key,name,enabled,is_default) VALUES ($1,$2,$3,$4) RETURNING id,printer_key,name,enabled,is_default", [printer_key, name, body.enabled !== false, body.is_default === true]);
    await audit(admin.id, "admin.printer_create", "label_printer", printer.id, { printer_key, name }, req);
    return ok({ printer }, 201);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "打印机标识已存在");
    throw e;
  }
});
