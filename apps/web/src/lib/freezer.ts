// 冰箱管理的共用逻辑（前后端都用，不依赖服务端模块）

export const TEMPERATURES = ["-80", "-20", "4"] as const;
export type Temperature = (typeof TEMPERATURES)[number];
export const tempLabel = (t: string) => `${t}℃`;

export const KIND_LABELS: Record<string, string> = { box: "盒子", basket: "框" };
// 界面上对「容器」的统称
export const CONTAINER_WORD = "盒子/框";

export const SAMPLE_LABELS: Record<string, string> = {
  name: "样品信息",
  project_no: "项目号",
  sample_type: "样品类型",
  remarks: "备注",
  stored_on: "存入日期",
};

export interface ContainerPos {
  freezer_name: string;
  temperature: string;
  shelf_no: number;
  rack_no: number | null;
  slot_no: number | null;
  tier_no?: number | null;
  depth_no?: number | null;
  kind: string;
  name: string;
}

// 架子里的格位：「架内第3层第2盒」
export const rackCellLabel = (tier: number, depth: number) => `架内第${tier}层第${depth}盒`;

// 位置显示为一行：「-80 1号（-80℃） · 第2层 · 3号架 · 第4格 · 盒子「名称」」；
// 放在架子格位里的盒子显示为「… · 3号架 · 架内第3层第2盒 · 盒子「名称」」
export function formatLocation(c: ContainerPos): string {
  const parts = [`${c.freezer_name}（${tempLabel(c.temperature)}）`, `第${c.shelf_no}层`];
  if (c.rack_no) parts.push(`${c.rack_no}号架`);
  if (c.tier_no && c.depth_no) parts.push(rackCellLabel(c.tier_no, c.depth_no));
  else if (c.slot_no) parts.push(`第${c.slot_no}格`);
  parts.push(`${KIND_LABELS[c.kind] ?? c.kind}「${c.name}」`);
  return parts.join(" · ");
}

export interface SampleDraft {
  name: string;
  project_no: string;
  sample_type: string;
  remarks: string;
}

// 批量存入：每行一管，列顺序为 样品信息、项目号、样品类型、备注（Tab 分隔，便于从 Excel 粘贴；
// 不按逗号拆分，因为样品名里常带逗号）。
// 空列用统一填写的默认值；空行跳过；首行若是表头则跳过。
export function parseSampleLines(text: string, defaults: Partial<SampleDraft> = {}): SampleDraft[] {
  const out: SampleDraft[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const cols = line.split("\t").map((s) => s.trim());
    if (i === 0 && cols[0] === SAMPLE_LABELS.name) return;
    if (!cols[0]) return;
    out.push({
      name: cols[0],
      project_no: cols[1] || defaults.project_no?.trim() || "",
      sample_type: cols[2] || defaults.sample_type?.trim() || "",
      remarks: cols[3] || defaults.remarks?.trim() || "",
    });
  });
  return out;
}
