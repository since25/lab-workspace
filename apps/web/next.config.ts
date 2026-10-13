import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 生成可独立运行的 .next/standalone，部署到 windows-wg 时无需 npm install
  output: "standalone",
  serverExternalPackages: ["exceljs", "pg"],
  images: { unoptimized: true },
};

export default nextConfig;
