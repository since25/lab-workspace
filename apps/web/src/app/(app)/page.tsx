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
      {/* 模块入口：按顶栏分组排列，整张卡片可点 */}
      <h2 className="section-title">资源管理</h2>
      <div className="module-grid">
        <div className="module-card">
          <Link href="/cells" className="module-name">细胞冻存</Link>
          <span className="module-meta"><strong>{s.cells}</strong> 条记录</span>
          {Number(s.review) > 0 && (
            <Link href="/cells?review=1" className="module-alert">{s.review} 条待核对</Link>
          )}
        </div>
        <div className="module-card">
          <Link href="/freezer" className="module-name">冰箱管理</Link>
          <span className="module-meta">我存放的在库样品 <strong>{s.samples}</strong> 管</span>
        </div>
        <div className="module-card">
          <Link href="/materials" className="module-name">部门物料</Link>
          <span className="module-meta"><strong>{s.materials}</strong> 条采购记录</span>
        </div>
        <div className="module-card">
          <Link href="/assets" className="module-name">固定资产</Link>
          <span className="module-meta"><strong>{s.assets}</strong> 件研发部资产</span>
        </div>
        <div className="module-card">
          <Link href="/guides" className="module-name">我的 Guide</Link>
          <span className="module-meta"><strong>{s.guides}</strong> 条</span>
        </div>
      </div>
      <h2 className="section-title">分析工具</h2>
      <div className="module-grid">
        <div className="module-card">
          <Link href="/tools/sanger" className="module-name">Sanger 分析</Link>
          <span className="module-meta">上传 .ab1，按规则命名，计算编辑效率并下载结果</span>
        </div>
        <div className="module-card">
          <Link href="/tools/nanopore" className="module-name">纳米孔分析</Link>
          <span className="module-meta">上传厂商交付包，计算各样本编辑效率</span>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 20 }}>
        分析上传的文件只临时保存，{process.env.TEMP_JOB_TTL_HOURS || 24} 小时后自动删除，请及时下载结果。
      </p>
    </>
  );
}
