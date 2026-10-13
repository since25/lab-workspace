import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { csvResponse, toCsv } from "@/lib/csv";
import { query } from "@/lib/db";
import { handle } from "@/lib/http";
import { GUIDE_HEADERS } from "@/lib/imports/guides";

export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const cols = ["name", "target", "sequence", "pam", "strand", "target_position", "target_base", "edited_base", "notes"];
  // ?template=1：只下载表头，作为批量导入模板
  if (new URL(req.url).searchParams.get("template") === "1") return csvResponse("guide-template.csv", toCsv(GUIDE_HEADERS, []));
  const rows = await query<Record<string, unknown>>("SELECT * FROM guides WHERE owner_id = $1 ORDER BY name", [user.id]);
  await audit(user.id, "guide.export", "guide", "", { count: rows.length }, req);
  return csvResponse("guides.csv", toCsv(GUIDE_HEADERS, rows.map((r) => cols.map((c) => r[c]))));
});
