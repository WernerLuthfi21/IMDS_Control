import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security/headers";

const dev = process.env.NODE_ENV !== "production";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["exceljs"],
  poweredByHeader: false,
  outputFileTracingIncludes: { "/imds-tracker": ["./private/imds-tracker.html", "./private/shared-master-sync.js"] },
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
  async headers() {
    return [
      // App pages: the CSP with a per-request nonce comes from proxy.ts; API routes need no CSP.
      { source: "/((?!imds-tracker).*)", headers: securityHeaders({ dev, supabaseUrl, csp: false }) },
      { source: "/imds-tracker/:path*", headers: securityHeaders({ dev, supabaseUrl, tracker: true }) },
      { source: "/imds-tracker", headers: securityHeaders({ dev, supabaseUrl, tracker: true }) }
    ];
  }
};
export default nextConfig;
