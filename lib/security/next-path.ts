/** Accept only same-origin relative paths for post-login redirects (prevents open redirects). */
export function safeNextPath(value: unknown, fallback = "/workspace"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.startsWith("/login")) return fallback;
  return value;
}
