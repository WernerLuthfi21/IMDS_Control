/**
 * Read-only Microsoft Graph access to ONE master workbook in SharePoint.
 * - Uses the app-only client-credentials flow; secrets stay in server env vars (never NEXT_PUBLIC_*).
 * - Only reads. Write-back to Excel is NOT implemented (Graph range update needs a signed-in user, approval UX and audit; see docs/SHAREPOINT_SETUP.md).
 */
const GRAPH = "https://graph.microsoft.com/v1.0";
const REQUIRED = ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "SHAREPOINT_SITE_HOSTNAME", "SHAREPOINT_SITE_PATH", "SHAREPOINT_MASTER_FILE_PATH"] as const;

export type SharePointConfig = { configured: boolean; missing: string[] };
export type MasterFileInfo = { name: string; size: number; lastModified: string; eTag: string; webUrl: string; lastModifiedBy: string | null };

export function sharepointConfig(env: Record<string, string | undefined> = process.env): SharePointConfig {
  const missing = REQUIRED.filter((k) => !env[k]?.trim());
  return { configured: missing.length === 0, missing };
}

class GraphError extends Error { constructor(message: string, readonly status: number) { super(message); } }

async function graphFetch(url: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const { token, ...rest } = init;
  const res = await fetch(url, { ...rest, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers || {}) }, signal: AbortSignal.timeout(40_000) });
  return res;
}

async function failure(res: Response, what: string): Promise<GraphError> {
  let detail = "";
  try { const j = await res.json() as { error?: { message?: string } | string; error_description?: string }; detail = typeof j.error === "string" ? (j.error_description || j.error) : j.error?.message || ""; } catch { /* no body */ }
  const hint = res.status === 401 ? " (check the tenant, client id and secret)" : res.status === 403 ? " (the app has no permission on this site; grant Sites.Selected read or Files.Read.All)" : res.status === 404 ? " (check the site path and file path)" : "";
  return new GraphError(`${what} failed with HTTP ${res.status}${hint}${detail ? `: ${detail.slice(0, 200)}` : ""}`, res.status);
}

export async function getAppToken(env: Record<string, string | undefined> = process.env): Promise<string> {
  const body = new URLSearchParams({ client_id: env.MS_CLIENT_ID!, client_secret: env.MS_CLIENT_SECRET!, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" });
  const res = await graphFetch(`https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT_ID!)}/oauth2/v2.0/token`, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  if (!res.ok) throw await failure(res, "Microsoft sign-in");
  const j = await res.json() as { access_token?: string };
  if (!j.access_token) throw new GraphError("Microsoft sign-in returned no token.", 502);
  return j.access_token;
}

export const encodePath = (p: string) => p.split("/").filter(Boolean).map(encodeURIComponent).join("/");

async function resolveItem(token: string, env: Record<string, string | undefined>) {
  const siteRes = await graphFetch(`${GRAPH}/sites/${env.SHAREPOINT_SITE_HOSTNAME}:/${encodePath(env.SHAREPOINT_SITE_PATH!)}`, { token });
  if (!siteRes.ok) throw await failure(siteRes, "Finding the SharePoint site");
  const site = await siteRes.json() as { id: string };
  const itemRes = await graphFetch(`${GRAPH}/sites/${site.id}/drive/root:/${encodePath(env.SHAREPOINT_MASTER_FILE_PATH!)}`, { token });
  if (!itemRes.ok) throw await failure(itemRes, "Finding the master workbook");
  const item = await itemRes.json() as { id: string; name: string; size: number; lastModifiedDateTime: string; eTag: string; webUrl: string; lastModifiedBy?: { user?: { displayName?: string } }; folder?: unknown };
  if (item.folder) throw new GraphError("SHAREPOINT_MASTER_FILE_PATH points to a folder, not a workbook.", 422);
  return { siteId: site.id, item };
}

export async function getMasterFileInfo(env: Record<string, string | undefined> = process.env): Promise<MasterFileInfo> {
  const token = await getAppToken(env);
  const { item } = await resolveItem(token, env);
  return { name: item.name, size: item.size, lastModified: item.lastModifiedDateTime, eTag: item.eTag, webUrl: item.webUrl, lastModifiedBy: item.lastModifiedBy?.user?.displayName ?? null };
}

export async function downloadMaster(maxBytes: number, env: Record<string, string | undefined> = process.env): Promise<{ info: MasterFileInfo; data: Buffer }> {
  const token = await getAppToken(env);
  const { siteId, item } = await resolveItem(token, env);
  if (item.size > maxBytes) throw new GraphError(`The master workbook is ${(item.size / 1048576).toFixed(1)} MB, above the ${Math.round(maxBytes / 1048576)} MB import limit.`, 413);
  const res = await graphFetch(`${GRAPH}/sites/${siteId}/drive/items/${item.id}/content`, { token, redirect: "follow" });
  if (!res.ok) throw await failure(res, "Downloading the master workbook");
  const data = Buffer.from(await res.arrayBuffer());
  return { info: { name: item.name, size: item.size, lastModified: item.lastModifiedDateTime, eTag: item.eTag, webUrl: item.webUrl, lastModifiedBy: item.lastModifiedBy?.user?.displayName ?? null }, data };
}
export { GraphError };
