import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { requireLabelPrinting } from "@/lib/label-print";
import { listSourceItems, parseSource } from "@/lib/label-sources";

export const GET = handle(async (req: Request) => {
  requireLabelPrinting(await requireUser());
  const sp = new URL(req.url).searchParams;
  return ok(await listSourceItems(query, parseSource(sp.get("source")), sp));
});
