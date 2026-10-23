"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@/lib/auth";

type NavItem = { href: string; label: string };
type NavGroup = { key: string; label: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    key: "samples",
    label: "样品",
    items: [
      { href: "/cells", label: "细胞冻存" },
      { href: "/freezer", label: "冰箱管理" },
    ],
  },
  {
    key: "stock",
    label: "库存",
    items: [
      { href: "/materials", label: "部门物料" },
      { href: "/materials/stock", label: "常用耗材" },
      { href: "/assets", label: "固定资产" },
    ],
  },
  {
    key: "tools",
    label: "工具",
    items: [
      { href: "/tools/sanger", label: "Sanger 分析" },
      { href: "/tools/nanopore", label: "纳米孔分析" },
    ],
  },
  {
    key: "more",
    label: "其他",
    items: [
      { href: "/guides", label: "我的 Guide" },
      { href: "/feedback", label: "留言板" },
    ],
  },
];

const ADMIN_GROUP: NavGroup = {
  key: "admin",
  label: "管理",
  items: [
    { href: "/admin/users", label: "账号管理" },
    { href: "/admin/printers", label: "打印机管理" },
    { href: "/admin/materials", label: "物料审批" },
    { href: "/admin/materials/reconcile", label: "库存校对" },
    { href: "/admin/audit", label: "操作记录" },
  ],
};

// 顶栏按功能分组，避免链接多了以后换行；分组在窄屏也保持一行。
export default function TopBar({ user }: { user: SessionUser }) {
  const path = usePathname();
  const groups: NavGroup[] = GROUPS.map((group) => {
    if (group.key !== "tools" || !user.label_print_enabled) return group;
    return { ...group, items: [...group.items, { href: "/label-print", label: "标签打印" }] };
  });
  if (user.role === "admin") groups.push(ADMIN_GROUP);

  const [open, setOpen] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const navRef = useRef<HTMLElement | null>(null);

  const inGroup = (group: NavGroup) =>
    group.items.some((item) => path === item.href || path.startsWith(`${item.href}/`));
  const currentHref = groups
    .flatMap((group) => group.items)
    .filter((item) => path === item.href || path.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  // 留言板角标：切换页面时、以及打开某条留言后刷新（不轮询）
  useEffect(() => {
    const refresh = () =>
      fetch("/api/v1/feedback/unread").then((r) => (r.ok ? r.json() : null)).then((d) => d && setUnread(d.count), () => {});
    refresh();
    window.addEventListener("feedback-read", refresh);
    return () => window.removeEventListener("feedback-read", refresh);
  }, [path]);

  // 换了页面就收起菜单
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setOpen(null); }, [path]);

  // 点空白处或按 Esc 收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header className="topbar">
      <Link href="/" className="brand">
        实验室工作台
      </Link>
      <nav ref={navRef} className="nav-menus" aria-label="主导航">
        {groups.map((group) => {
          const active = inGroup(group);
          const expanded = open === group.key;
          return (
            <div className="nav-group" key={group.key}>
              <button
                type="button"
                className={active ? "nav-btn active" : "nav-btn"}
                aria-haspopup="menu"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : group.key)}
              >
                {group.label}
                <span className="caret" aria-hidden="true">▾</span>
              </button>
              {expanded && (
                <div className="nav-panel" role="menu">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      className={currentHref === item.href ? "active" : ""}
                      onClick={() => setOpen(null)}
                    >
                      {item.label}
                      {item.href === "/feedback" && unread > 0 && <span className="badge" aria-label={`${unread} 条未读`}>{unread}</span>}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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
