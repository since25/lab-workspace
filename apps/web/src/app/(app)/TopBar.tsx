"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionUser } from "@/lib/auth";

const LINKS = [
  { href: "/cells", label: "细胞冻存" },
  { href: "/freezer", label: "冰箱管理" },
  { href: "/materials", label: "部门物料" },
  { href: "/assets", label: "固定资产" },
  { href: "/guides", label: "我的 Guide" },
  { href: "/tools/sanger", label: "Sanger 分析" },
  { href: "/tools/nanopore", label: "纳米孔分析" },
];
const ADMIN_LINKS = [
  { href: "/admin/users", label: "账号管理" },
  { href: "/admin/audit", label: "操作记录" },
];

export default function TopBar({ user }: { user: SessionUser }) {
  const path = usePathname();
  const links = user.role === "admin" ? [...LINKS, ...ADMIN_LINKS] : LINKS;

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
          <Link key={l.href} href={l.href} className={path.startsWith(l.href) ? "active" : ""}>
            {l.label}
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
