import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "@/lib/security/headers";

describe("security headers", () => {
  it("app pages: no foreign script hosts, no framing, no plugins", () => {
    const csp = contentSecurityPolicy({ dev: false, supabaseUrl: "https://abc.supabase.co" });
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/connect-src 'self' https:\/\/abc\.supabase\.co wss:\/\/abc\.supabase\.co/);
    expect(csp).not.toMatch(/cdnjs|jsdelivr|googleapis|unsafe-eval/);
  });
  it("tracker: only its own CDNs and Microsoft endpoints are added", () => {
    const csp = contentSecurityPolicy({ dev: false, tracker: true });
    expect(csp).toMatch(/script-src [^;]*https:\/\/cdnjs\.cloudflare\.com/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/graph\.microsoft\.com/);
  });
  it("dev allows eval for the dev server; production sends HSTS", () => {
    expect(contentSecurityPolicy({ dev: true })).toMatch(/'unsafe-eval'/);
    expect(securityHeaders({ dev: false }).some((h) => h.key === "Strict-Transport-Security")).toBe(true);
    expect(securityHeaders({ dev: true }).some((h) => h.key === "Strict-Transport-Security")).toBe(false);
  });
  it("app pages: a nonce turns on strict-dynamic; proxy sets it, next.config does not duplicate it", async () => {
    const { makeNonce } = await import("@/lib/security/headers");
    const n = makeNonce();
    expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(makeNonce()).not.toBe(n);
    expect(contentSecurityPolicy({ dev: false, nonce: n })).toContain(`script-src 'self' 'nonce-${n}' 'strict-dynamic'`);
    expect(securityHeaders({ dev: false, csp: false }).some((h) => h.key === "Content-Security-Policy")).toBe(false);
  });
});

