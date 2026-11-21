/**
 * HTTP security headers for every route (docs/SECURITY.md → Browser security headers).
 * CSP is enforced. Scripts still need 'unsafe-inline' because Next.js inline bootstrap scripts are not
 * nonce-tagged yet; the policy already blocks foreign script hosts, plugins, framing, <base> hijacking and
 * form posts or fetches to unknown origins. Next step: per-request nonce in proxy.ts.
 */
type Header = { key: string; value: string };

function origin(url: string | undefined): string | null {
  try { return url ? new URL(url).origin : null; } catch { return null; }
}

export function contentSecurityPolicy(opts: { dev: boolean; supabaseUrl?: string; tracker?: boolean }): string {
  const sb = origin(opts.supabaseUrl);
  const sbWs = sb ? sb.replace(/^http/, "ws") : null;
  // The IMDS Tracker (approved standalone page) loads its libraries from two CDNs and talks to Microsoft Graph.
  const trackerScripts = opts.tracker ? ["https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"] : [];
  const trackerConnect = opts.tracker ? ["https://graph.microsoft.com", "https://login.microsoftonline.com"] : [];
  const trackerFonts = opts.tracker ? ["https://fonts.googleapis.com"] : [];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(opts.dev ? ["'unsafe-eval'"] : []), "https://vercel.live", ...trackerScripts],
    "style-src": ["'self'", "'unsafe-inline'", ...trackerFonts],
    "img-src": ["'self'", "data:", "blob:", ...(sb ? [sb] : [])],
    "font-src": ["'self'", "data:", ...(opts.tracker ? ["https://fonts.gstatic.com"] : [])],
    "connect-src": ["'self'", ...(sb ? [sb] : []), ...(sbWs ? [sbWs] : []), ...(opts.dev ? ["ws:"] : []), "https://vercel.live", ...trackerConnect],
    "frame-src": ["'self'", "https://vercel.live", ...(opts.tracker ? ["https://login.microsoftonline.com"] : [])],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"]
  };
  return Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

export function securityHeaders(opts: { dev: boolean; supabaseUrl?: string; tracker?: boolean }): Header[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(opts) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    { key: "Cross-Origin-Opener-Policy", value: opts.tracker ? "same-origin-allow-popups" : "same-origin" },
    ...(opts.dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }])
  ];
}
