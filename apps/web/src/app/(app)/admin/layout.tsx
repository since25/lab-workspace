import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

// 管理页面仅管理员可见
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") redirect("/");
  return children;
}
