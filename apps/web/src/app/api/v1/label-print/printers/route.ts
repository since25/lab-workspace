import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { callLabelPrint, listPrinters, requireLabelPrinting, type Printer } from "@/lib/label-print";

export const GET = handle(async () => {
  requireLabelPrinting(await requireUser());
  const printers = await listPrinters(query);
  const withStatus = await Promise.all(printers.map(async (printer: Printer) => {
    try {
      const status = await callLabelPrint(`/api/status?printer_id=${encodeURIComponent(printer.printer_key)}`);
      return { ...printer, ...status };
    } catch (e) {
      return { ...printer, ready: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }));
  return ok({ printers: withStatus });
});
