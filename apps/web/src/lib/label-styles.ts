import type { TemplateKey } from "./label-sources";

// 前后端共用；与标签服务的样式范围、内置默认值保持一致。
export const ALIGNS = ["left", "center", "right"] as const;
export type Align = typeof ALIGNS[number];
export type LabelStyle = { name_pt: number; detail_pt: number; line_gap: number; name_align: Align; detail_align: Align };
export const STYLE_LIMITS = { name_pt: [12, 72], detail_pt: [10, 48], line_gap: [0, 20] } as const;
export const BUILTIN_STYLES: Record<TemplateKey, LabelStyle> = {
  "name-detail": { name_pt: 34, detail_pt: 20, line_gap: 2, name_align: "left", detail_align: "left" },
  uniform: { name_pt: 22, detail_pt: 22, line_gap: 2, name_align: "left", detail_align: "left" },
  "name-only": { name_pt: 46, detail_pt: 20, line_gap: 2, name_align: "left", detail_align: "left" },
};
