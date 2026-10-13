"use client";

import { useEffect, useState } from "react";
import { api, errText } from "@/lib/client";
import Combobox from "../../Combobox";

interface Log {
  id: number;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
  actor: string | null;
}

const ACTIONS: Record<string, string> = {
  "auth.login": "登录",
  "auth.login_failed": "登录失败",
  "auth.password_changed": "修改密码",
  "admin.bootstrap": "初始化管理员",
  "admin.user_create": "创建账号",
  "admin.user_update": "修改账号",
  "cell.create": "新增细胞记录",
  "cell.update": "修改细胞记录",
  "cell.delete": "删除细胞记录",
  "cell.import": "导入细胞登记表",
  "freezer.create": "新增冰箱",
  "freezer.update": "修改冰箱",
  "freezer.delete": "删除冰箱",
  "freezer_container.create": "新建冰箱容器",
  "freezer_container.update": "修改冰箱容器",
  "freezer_container.delete": "删除冰箱容器",
  "freezer_sample.create": "样品存入",
  "freezer_sample.update": "修改样品",
  "freezer_sample.move": "样品转移",
  "freezer_sample.remove": "样品取出",
  "freezer_sample.delete": "删除样品记录",
  "material.import_replace": "替换物料数据",
  "asset.import_replace": "替换固定资产数据",
  "guide.import": "批量导入 Guide",
  "guide.create": "新增 Guide",
  "guide.update": "修改 Guide",
  "guide.delete": "删除 Guide",
  "guide.export": "导出 Guide",
  "analysis.create": "上传分析文件",
  "analysis.run": "运行分析",
  "analysis.download": "下载分析结果",
  "analysis.delete": "清理分析任务",
};

export default function AuditPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    const sp = new URLSearchParams({ page: String(page) });
    if (action) sp.set("action", action);
    api<{ logs: Log[] }>(`/api/v1/admin/audit-logs?${sp}`).then((d) => setLogs(d.logs), (e) => setError(errText(e)));
  }, [action, page]);

  return (
    <>
      <h1>操作记录</h1>
      <div className="toolbar">
        <label className="field">
          类型
          <Combobox
            value={action}
            allowEmpty
            options={[
              { value: "auth.", label: "登录相关" },
              { value: "admin.", label: "账号管理" },
              { value: "cell.", label: "细胞冻存" },
              { value: "material.", label: "部门物料" },
              { value: "asset.", label: "固定资产" },
              { value: "guide.", label: "Guide" },
              { value: "analysis.", label: "分析" },
            ]}
            onChange={(v) => { setAction(v); setPage(1); }}
          />
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>对象</th><th>详情</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td style={{ whiteSpace: "nowrap" }}>{new Date(l.created_at).toLocaleString("zh-CN")}</td>
                <td>{l.actor ?? "—"}</td>
                <td>{ACTIONS[l.action] ?? l.action}</td>
                <td>{l.resource_type} {l.resource_id}</td>
                <td className="mono" style={{ maxWidth: 520 }}>{Object.keys(l.metadata_json).length ? JSON.stringify(l.metadata_json) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
        <span className="muted">第 {page} 页</span>
        <button disabled={logs.length < 100} onClick={() => setPage(page + 1)}>下一页</button>
      </div>
    </>
  );
}
