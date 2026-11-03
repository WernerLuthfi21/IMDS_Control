import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["exceljs"],
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "20mb" } }
};
export default nextConfig;
