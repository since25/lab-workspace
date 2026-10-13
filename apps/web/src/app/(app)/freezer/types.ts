import { formatLocation } from "@/lib/freezer";

export interface Freezer {
  id: number;
  name: string;
  temperature: string;
  location: string;
  remarks: string;
  is_active: boolean;
  // 布局：两项都有值时显示可视化布局
  shelf_count: number | null;
  racks_per_shelf: number | null;
}
export interface Rack {
  id: number;
  freezer_id: number;
  shelf_no: number;
  position: number;
  owner_id: number | null;
  owner_name: string | null;
  tiers: number;
  depth: number;
  remarks: string;
  used: number;
}
export interface Container {
  id: number;
  owner_id: number;
  owner_name: string;
  freezer_id: number;
  freezer_name: string;
  temperature: string;
  kind: string;
  name: string;
  shelf_no: number;
  rack_no: number | null;
  slot_no: number | null;
  tier_no: number | null;
  depth_no: number | null;
  is_shared: boolean;
  remarks: string;
  sample_count: number;
}
export interface Sample {
  id: number;
  owner_id: number;
  owner_name: string;
  container_id: number | null;
  name: string;
  project_no: string;
  sample_type: string;
  remarks: string;
  status: "stored" | "removed";
  stored_on: string;
  removed_at: string | null;
  kind: string | null;
  container_name: string | null;
  shelf_no: number | null;
  rack_no: number | null;
  slot_no: number | null;
  tier_no: number | null;
  depth_no: number | null;
  is_shared: boolean | null;
  freezer_name: string | null;
  temperature: string | null;
}

export const hasLayout = (f: Freezer | undefined): f is Freezer & { shelf_count: number; racks_per_shelf: number } =>
  !!f?.shelf_count && !!f?.racks_per_shelf;

export function sampleLocation(s: Sample) {
  if (s.container_id === null || !s.freezer_name) return "";
  return formatLocation({
    freezer_name: s.freezer_name, temperature: s.temperature!, shelf_no: s.shelf_no!, rack_no: s.rack_no,
    slot_no: s.slot_no, tier_no: s.tier_no, depth_no: s.depth_no, kind: s.kind!, name: s.container_name!,
  });
}
export const containerLabel = (c: Container) => `${c.is_shared ? "【公共】" : ""}${formatLocation(c)} · ${c.sample_count} 管`;

// 盒子/框表单（新建、编辑、存入时新建共用）
export const EMPTY_CONTAINER = {
  freezer_id: "", kind: "box", name: "", shelf_no: "", rack_no: "", slot_no: "", tier_no: "", depth_no: "", remarks: "", is_shared: false,
};
export type ContainerForm = typeof EMPTY_CONTAINER;

export function containerForm(c: Container | null): ContainerForm {
  if (!c) return EMPTY_CONTAINER;
  const s = (v: number | null) => (v === null ? "" : String(v));
  return {
    freezer_id: String(c.freezer_id), kind: c.kind, name: c.name, shelf_no: String(c.shelf_no), rack_no: s(c.rack_no),
    slot_no: s(c.slot_no), tier_no: s(c.tier_no), depth_no: s(c.depth_no), remarks: c.remarks, is_shared: c.is_shared,
  };
}
