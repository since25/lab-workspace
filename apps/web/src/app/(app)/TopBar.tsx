"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { SessionUser } from "@/lib/auth";

const LINKS = [
  { href: "/cells", label: "细胞冻存" },
  { href: "/freezer", label: "冰箱管理" },
  { href: "/materials", label: "部门物料" },
  { href: "/materials/stock", label: "常用耗材" },
  { href: "/assets", label: "固定资产" },
  { href: "/guides", label: "我的 Guide" },
  { href: "/tools/sanger", label: "Sanger 分析" },
  { href: "/tools/nanopore", label: "纳米孔分析" },
  { href: "/feedback", label: "留言板" },
];
const ADMIN_LINKS = [
  { href: "/admin/users", label: "账号管理" },
  { href: "/admin/tenants", label: "租户管理" },
  { href: "/admin/printers", label: "打印机管理" },
  { href: "/admin/materials", label: "物料审批" },
  { href: "/admin/materials/reconcile", label: "库存校对" },
  { href: "/admin/audit", label: "操作记录" },
];

export default function TopBar({ user }: { user: SessionUser }) {
  const path = usePathname();
  const links = [
    ...(user.label_print_enabled ? [{ href: "/label-print", label: "标签打印" }] : []),
    ...(user.role === "admin" ? [...LINKS, ...ADMIN_LINKS] : LINKS),
  ];
  // 取最长前缀，避免 /materials 与 /materials/stock 同时高亮。
  const activeHref = links
    .filter((l) => path === l.href || path.startsWith(`${l.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const [unread, setUnread] = useState(0);

  // 留言板角标：切换页面时、以及打开某条留言后刷新（不轮询）
  useEffect(() => {
    const refresh = () =>
      fetch("/api/v1/feedback/unread").then((r) => (r.ok ? r.json() : null)).then((d) => d && setUnread(d.count), () => {});
    refresh();
    window.addEventListener("feedback-read", refresh);
    return () => window.removeEventListener("feedback-read", refresh);
  }, [path]);

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header className="topbar">
      <Link href="/" className="brand">
        实验室工作台
      </Link>
      <nav>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={activeHref === l.href ? "active" : ""}>
            {l.label}
            {l.href === "/feedback" && unread > 0 && <span className="badge" aria-label={`${unread} 条未读`}>{unread}</span>}
          </Link>
        ))}
      </nav>
      <div className="user">
        <Link href="/account">{user.display_name}</Link>
        <button className="link" onClick={logout}>
          退出
        </button>
      </div>
    </header>
  );
}
