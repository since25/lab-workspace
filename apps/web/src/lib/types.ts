export interface Guide {
  id: number;
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
