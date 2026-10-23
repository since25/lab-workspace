import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { listPrintableMaterials, requireLabelPrinting } from "@/lib/label-print";

export const GET = handle(async (req: Request) => {
  const user = requireLabelPrinting(await requireUser());
  return ok({ ...await listPrintableMaterials(query, new URL(req.url).searchParams), tenant: user.tenant_name });
});
