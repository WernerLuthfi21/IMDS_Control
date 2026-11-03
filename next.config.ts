import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["exceljs"],
  poweredByHeader: false,
  outputFileTracingIncludes: { "/imds-tracker": ["./private/imds-tracker.html"] },
  experimental: { serverActions: { bodySizeLimit: "20mb" } }
};
export default nextConfig;
