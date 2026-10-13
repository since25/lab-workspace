import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import TopBar from "./TopBar";

// 登录后的页面统一在这里校验会话
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <>
      <TopBar user={user} />
      <main>{children}</main>
    </>
  );
}
