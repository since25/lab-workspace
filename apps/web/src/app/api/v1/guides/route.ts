import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { parseGuide } from "@/lib/guides";
import { HttpError, handle, ok, readJson } from "@/lib/http";

export const GET = handle(async () => {
  const user = await requireUser();
  const guides = await query("SELECT * FROM guides WHERE owner_id = $1 ORDER BY name", [user.id]);
  return ok({ guides });
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const g = parseGuide(await readJson(req));
  try {
    const [row] = await query<{ id: number }>(
      `INSERT INTO guides(owner_id, name, target, sequence, pam, strand, target_position, target_base, edited_base, notes, bystander_position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [user.id, g.name, g.target, g.sequence, g.pam, g.strand, g.target_position, g.target_base, g.edited_base, g.notes, g.bystander_position]
    );
    await audit(user.id, "guide.create", "guide", row.id, {}, req);
    return ok({ guide: row }, 201);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "已有同名 Guide");
    throw e;
  }
});
