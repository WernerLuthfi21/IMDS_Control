/**
 * HTTP security headers for every route (docs/SECURITY.md → Browser security headers).
 * CSP is enforced. App pages get a per-request nonce from proxy.ts ('nonce-…' + 'strict-dynamic'): an inline
 * script without the nonce does not run. 'unsafe-inline' stays only as the fallback CSP1 browsers read (CSP2+
 * browsers ignore it when a nonce is present). The approved Tracker page has inline handlers, so it keeps its
 * own policy without a nonce (set in next.config.ts).
 */
type Header = { key: string; value: string };

function origin(url: string | undefined): string | null {
  try { return url ? new URL(url).origin : null; } catch { return null; }
}

export function contentSecurityPolicy(opts: { dev: boolean; supabaseUrl?: string; tracker?: boolean; nonce?: string }): string {
  const sb = origin(opts.supabaseUrl);
  const sbWs = sb ? sb.replace(/^http/, "ws") : null;
  // The IMDS Tracker (approved standalone page) loads its libraries from two CDNs and talks to Microsoft Graph.
  const trackerScripts = opts.tracker ? ["https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"] : [];
  const trackerConnect = opts.tracker ? ["https://graph.microsoft.com", "https://login.microsoftonline.com"] : [];
  const trackerFonts = opts.tracker ? ["https://fonts.googleapis.com"] : [];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", ...(opts.nonce ? [`'nonce-${opts.nonce}'`, "'strict-dynamic'"] : []), "'unsafe-inline'", ...(opts.dev ? ["'unsafe-eval'"] : []), "https://vercel.live", ...trackerScripts],
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

/** A fresh nonce per request (base64 of 16 random bytes). */
export function makeNonce(): string {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

/** Static headers for next.config.ts. `csp: false` when proxy.ts sets the nonce CSP for that route. */
export function securityHeaders(opts: { dev: boolean; supabaseUrl?: string; tracker?: boolean; csp?: boolean }): Header[] {
  return [
    ...(opts.csp === false ? [] : [{ key: "Content-Security-Policy", value: contentSecurityPolicy(opts) }]),
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    { key: "Cross-Origin-Opener-Policy", value: opts.tracker ? "same-origin-allow-popups" : "same-origin" },
    ...(opts.dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }])
  ];
}
