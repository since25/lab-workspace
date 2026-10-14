import { query } from "./db";

// 分析看板：样品数取自操作记录里每次「分析完成」（analysis.run）记下的成功样品数，
// 不另建表，历史分析也计入。同一批重新分析会再计一次。
// 分析服务返回的 n_success 可能是数字或单元素数组，两种都兼容。
const N_SUCCESS = `CASE jsonb_typeof(metadata_json->'n_success')
  WHEN 'number' THEN (metadata_json->>'n_success')::numeric
  WHEN 'array' THEN (metadata_json->'n_success'->>0)::numeric
  ELSE 0 END`;

export interface AnalysisStats {
  sanger: number; // 我的 Sanger 样品数
  nanopore: number; // 我的纳米孔样品数
  total: number; // 全站总数（不分来源）
}

export async function analysisStats(userId: number): Promise<AnalysisStats> {
  const [r] = await query<{ sanger: string; nanopore: string; total: string }>(
    `SELECT COALESCE(sum(${N_SUCCESS}) FILTER (WHERE actor_id = $1 AND metadata_json->>'kind' = 'sanger'), 0) AS sanger,
            COALESCE(sum(${N_SUCCESS}) FILTER (WHERE actor_id = $1 AND metadata_json->>'kind' = 'nanopore'), 0) AS nanopore,
            COALESCE(sum(${N_SUCCESS}), 0) AS total
       FROM audit_logs WHERE action = 'analysis.run'`,
    [userId]
  );
  return { sanger: Number(r.sanger), nanopore: Number(r.nanopore), total: Number(r.total) };
}
