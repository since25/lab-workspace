import { HttpError, str } from "./http";

export interface GuideInput {
  name: string;
  target: string;
  sequence: string;
  pam: string;
  strand: string;
  target_position: number | null;
  bystander_position: number | null;
  target_base: string;
  edited_base: string;
  notes: string;
}

const IUPAC = /^[ACGTRYSWKMBDHVN]+$/;

// 旁观位须与目标位同一种碱基：分析只在 guide 上等于目标碱基的位点计算编辑率，
// 指到别的碱基不会报错，只会让旁观位两列静默为空。base 为空时无从比较，不拦。
export function bystanderBaseError(sequence: string, bystander: number, base: string): string | null {
  if (!base) return null;
  const got = sequence[bystander - 1];
  return got === base ? null : `旁观位第 ${bystander} 位是 ${got}，与目标碱基 ${base} 不同；旁观位必须与目标位是同一种碱基`;
}

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
  const bp = str(body.bystander_position);
  let bystander_position: number | null = null;
  if (bp) {
    bystander_position = Number(bp);
    if (!Number.isInteger(bystander_position) || bystander_position < 1 || bystander_position > sequence.length) {
      throw new HttpError(400, "旁观位必须是序列范围内的整数");
    }
    if (bystander_position === target_position) throw new HttpError(400, "旁观位不能与目标位置相同");
  }
  const target_base = str(body.target_base).toUpperCase();
  const edited_base = str(body.edited_base).toUpperCase();
  for (const b of [target_base, edited_base]) {
    if (b && !/^[ACGT]$/.test(b)) throw new HttpError(400, "碱基只能是 A/C/G/T");
  }
  if (bystander_position !== null) {
    // 没填目标碱基时，以目标位置上的碱基为准
    const base = target_base || (target_position !== null ? sequence[target_position - 1] : "");
    const err = bystanderBaseError(sequence, bystander_position, base);
    if (err) throw new HttpError(400, err);
  }
  return { name, target: str(body.target), sequence, pam, strand, target_position, bystander_position, target_base, edited_base, notes: str(body.notes) };
}
