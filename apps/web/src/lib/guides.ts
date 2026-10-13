import { HttpError, str } from "./http";

export interface GuideInput {
  name: string;
  target: string;
  sequence: string;
  pam: string;
  strand: string;
  target_position: number | null;
  target_base: string;
  edited_base: string;
  notes: string;
}

const IUPAC = /^[ACGTRYSWKMBDHVN]+$/;

// 校验并规范化 Guide：序列统一大写、去空白，只允许 IUPAC 字符
export function parseGuide(body: Record<string, unknown>): GuideInput {
  const name = str(body.name);
  if (!name) throw new HttpError(400, "名称不能为空");
  const sequence = str(body.sequence).toUpperCase().replace(/\s+/g, "");
  if (!sequence) throw new HttpError(400, "序列不能为空");
  if (!IUPAC.test(sequence)) throw new HttpError(400, "序列只能包含 IUPAC 碱基字符（A/C/G/T/N 等）");
  const pam = str(body.pam).toUpperCase().replace(/\s+/g, "");
  if (pam && !IUPAC.test(pam)) throw new HttpError(400, "PAM 只能包含 IUPAC 碱基字符");
  const strand = str(body.strand);
  if (!["", "+", "-"].includes(strand)) throw new HttpError(400, "链方向只能是 + 或 -");
  const tp = str(body.target_position);
  let target_position: number | null = null;
  if (tp) {
    target_position = Number(tp);
    if (!Number.isInteger(target_position) || target_position < 1 || target_position > sequence.length) {
      throw new HttpError(400, "目标位置必须是序列范围内的整数");
    }
  }
  const target_base = str(body.target_base).toUpperCase();
  const edited_base = str(body.edited_base).toUpperCase();
  for (const b of [target_base, edited_base]) {
    if (b && !/^[ACGT]$/.test(b)) throw new HttpError(400, "碱基只能是 A/C/G/T");
  }
  return { name, target: str(body.target), sequence, pam, strand, target_position, target_base, edited_base, notes: str(body.notes) };
}
