import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "实验室工作台",
  description: "测序分析工具与实验室资源管理",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
