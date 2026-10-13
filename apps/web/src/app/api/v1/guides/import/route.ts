import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { HttpError, handle, ok } from "@/lib/http";
import { parseGuideSheet } from "@/lib/imports/guides";
import { readWorkbook } from "@/lib/imports/sheet";
import { readImportFile } from "@/lib/upload";

// 批量导入自己的 Guide：preview 只预览；commit 写入，同名覆盖、新名新增
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const { name, buf, mode } = await readImportFile(req);
  let sheets;
  try {
    sheets = await readWorkbook(buf, name);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const { rows, issues, fatal } = parseGuideSheet(sheets[0] ?? { name, rows: [] });
  if (fatal) throw new HttpError(400, fatal);
  const existing = new Set((await query<{ name: string }>("SELECT name FROM guides WHERE owner_id = $1", [user.id])).map((r) => r.name));
  const updates = rows.filter((g) => existing.has(g.name)).length;
  const summary = { total: rows.length, new_rows: rows.length - updates, updates, issues };
  if (mode !== "commit") return ok({ preview: true, ...summary });
  if (!rows.length) throw new HttpError(400, "文件里没有可导入的 Guide");
  await withTransaction(async (c) => {
    for (const g of rows) {
      await c.query(
        `INSERT INTO guides(owner_id, name, target, sequence, pam, strand, target_position, target_base, edited_base, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (owner_id, name) DO UPDATE SET target=EXCLUDED.target, sequence=EXCLUDED.sequence, pam=EXCLUDED.pam,
           strand=EXCLUDED.strand, target_position=EXCLUDED.target_position, target_base=EXCLUDED.target_base,
           edited_base=EXCLUDED.edited_base, notes=EXCLUDED.notes, updated_at=now()`,
        [user.id, g.name, g.target, g.sequence, g.pam, g.strand, g.target_position, g.target_base, g.edited_base, g.notes]
      );
    }
    await audit(user.id, "guide.import", "guide", "", { filename: name, inserted: summary.new_rows, updated: updates, issues: issues.length }, req, c);
  });
  return ok({ committed: true, ...summary });
});
