import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadMaster, encodePath, getMasterFileInfo, sharepointConfig } from "@/lib/sharepoint/graph";

const env = { MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s", SHAREPOINT_SITE_HOSTNAME: "x.sharepoint.com", SHAREPOINT_SITE_PATH: "sites/IMDS", SHAREPOINT_MASTER_FILE_PATH: "Shared Documents/Master Data.xlsx" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("sharepoint config", () => {
  it("lists missing variables and never needs a value to report them", () => {
    expect(sharepointConfig({}).missing).toHaveLength(6);
    expect(sharepointConfig(env).configured).toBe(true);
  });
  it("encodes each path segment", () => { expect(encodePath("Shared Documents/Master Data.xlsx")).toBe("Shared%20Documents/Master%20Data.xlsx"); });
});

describe("graph client (mocked fetch)", () => {
  it("reads file info through token → site → item", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("oauth2")) return json({ access_token: "tok" });
      if (String(url).includes("/sites/x.sharepoint.com:/")) return json({ id: "site1" });
      return json({ id: "item1", name: "Master Data.xlsx", size: 10, lastModifiedDateTime: "2026-11-06T01:00:00Z", eTag: "e", webUrl: "https://x/y", lastModifiedBy: { user: { displayName: "Aiko" } } });
    }));
    const info = await getMasterFileInfo(env);
    expect(info.name).toBe("Master Data.xlsx"); expect(info.lastModifiedBy).toBe("Aiko");
    expect(calls[2]).toContain("/sites/site1/drive/root:/Shared%20Documents/Master%20Data.xlsx");
  });
  it("downloads the content and refuses files above the limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("oauth2")) return json({ access_token: "tok" });
      if (String(url).includes("/sites/x.sharepoint.com:/")) return json({ id: "site1" });
      if (String(url).endsWith("/content")) return new Response(new Uint8Array([1, 2, 3]));
      return json({ id: "item1", name: "m.xlsx", size: 3, lastModifiedDateTime: "z", eTag: "e", webUrl: "u" });
    }));
    expect((await downloadMaster(100, env)).data.length).toBe(3);
    await expect(downloadMaster(2, env)).rejects.toThrow(/above the/);
  });
  it("turns Graph errors into readable messages without leaking secrets", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "invalid_client", error_description: "bad secret" }, 401)));
    await expect(getMasterFileInfo(env)).rejects.toThrow(/HTTP 401.*client id and secret/);
    await expect(getMasterFileInfo(env)).rejects.not.toThrow(/\bs\b$/);
  });
});
