import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { analysisStats } from "@/lib/stats";

export default async function Home() {
  const user = await getCurrentUser();
  const [s] = await query<{ cells: string; review: string; samples: string; materials: string; assets: string; guides: string }>(
    `SELECT (SELECT count(*) FROM cell_inventory) AS cells,
            (SELECT count(*) FROM cell_inventory WHERE needs_review) AS review,
            (SELECT count(*) FROM freezer_samples WHERE owner_id = $1 AND status = 'stored') AS samples,
            (SELECT count(*) FROM material_items) AS materials,
            (SELECT count(*) FROM fixed_assets) AS assets,
            (SELECT count(*) FROM guides WHERE owner_id = $1) AS guides`,
    [user!.id]
  );
  const a = await analysisStats(user!.id);
  return (
    <>
      <h1>你好，{user!.display_name}</h1>
      {/* 分析看板：个人按 Sanger / 纳米孔分开计，全站只显示总数 */}
      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="muted">我分析的 Sanger 样品</span>
          <strong>{a.sanger.toLocaleString()}</strong>
        </div>
        <div className="stat-tile">
          <span className="muted">我分析的纳米孔样品</span>
          <strong>{a.nanopore.toLocaleString()}</strong>
        </div>
        <div className="stat-tile">
          <span className="muted">全站累计分析样品</span>
          <strong>{a.total.toLocaleString()}</strong>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <tbody>
            <tr>
              <td><Link href="/cells">细胞冻存</Link></td>
              <td>
                {s.cells} 条记录
                {Number(s.review) > 0 && (
                  <>
                    ，<Link href="/cells?review=1">{s.review} 条待核对</Link>
                  </>
                )}
              </td>
            </tr>
            <tr>
              <td><Link href="/freezer">冰箱管理</Link></td>
              <td>我存放的在库样品 {s.samples} 管</td>
            </tr>
            <tr>
              <td><Link href="/materials">部门物料</Link></td>
              <td>{s.materials} 条采购记录</td>
            </tr>
            <tr>
              <td><Link href="/assets">固定资产</Link></td>
              <td>{s.assets} 件研发部资产</td>
            </tr>
            <tr>
              <td><Link href="/guides">我的 Guide</Link></td>
              <td>{s.guides} 条</td>
            </tr>
            <tr>
              <td><Link href="/tools/sanger">Sanger 分析</Link></td>
              <td>上传 .ab1，按规则命名，计算编辑效率并下载结果</td>
            </tr>
            <tr>
              <td><Link href="/tools/nanopore">纳米孔分析</Link></td>
              <td>上传厂商交付包，计算各样本编辑效率</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 12 }}>
        分析上传的文件只临时保存，{process.env.TEMP_JOB_TTL_HOURS || 24} 小时后自动删除，请及时下载结果。
      </p>
    </>
  );
}
