import { createHash } from "node:crypto";

/** CSRF defence for cookie-less public JSON POSTs: the browser must send an Origin that matches the host. */
export function sameOrigin(headers: Headers) {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") || headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export function hashKey(...parts: string[]) {
  return createHash("sha256").update(parts.join("|") + "|" + (process.env.THROTTLE_SALT || "imds")).digest("hex").slice(0, 32);
}
export function clientKey(headers: Headers) {
  const ip = (headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  return hashKey("ip", ip);
}
export function siteOrigin(headers: Headers) {
  const env = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  if (env && /^https?:\/\//.test(env)) return env;
  const host = headers.get("x-forwarded-host") || headers.get("host") || "localhost:3000";
  const proto = headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
