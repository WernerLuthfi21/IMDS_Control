import { expect, test, type Page } from "@playwright/test";
import { auditContrast } from "./contrast";

/** Dev mode shows server HTML before React is interactive: repeat the action until it takes effect. */
async function untilItWorks(act: () => Promise<void>, check: () => Promise<void>) {
  await expect(async () => { await act(); await check(); }).toPass({ timeout: 20_000, intervals: [500, 1000, 2000] });
}

// Browser errors are attached to every failure so a page that never becomes interactive says why.
const browserErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  browserErrors.length = 0;
  page.on("pageerror", (e) => browserErrors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") browserErrors.push("console: " + m.text().slice(0, 300)); });
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus && browserErrors.length) console.log("BROWSER ERRORS for " + info.title + "\n" + browserErrors.slice(0, 12).join("\n"));
});

// Pages that render without a database (the CI server runs with no Supabase env in dev mode).
// Judgement, Tracker and the register need a signed-in Supabase session and are not covered here.
const PAGES: Array<{ path: string; ready: (p: Page) => Promise<void> }> = [
  { path: "/rules", ready: async (p) => { await expect(p.getByRole("heading", { name: "Judgement Rules" })).toBeVisible(); } },
  { path: "/settings", ready: async (p) => { await expect(p.getByRole("tab", { name: /Judgement/ })).toBeVisible(); } },
  { path: "/daily-update", ready: async (p) => { await expect(p.getByRole("heading", { name: "Daily G-CATS Update" })).toBeVisible(); } },
  { path: "/supplier-precheck", ready: async (p) => { await expect(p.getByRole("tab", { name: /Check a file/ })).toBeVisible(); } },
  { path: "/login", ready: async (p) => { await expect(p.getByRole("heading", { name: "Sign in" })).toBeVisible(); } }
];

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => { try { localStorage.setItem("imds-theme", t); } catch { /* storage blocked */ } }, theme);
      await page.emulateMedia({ reducedMotion: "reduce" });
    });
    for (const p of PAGES) {
      test(`${p.path} renders and passes the contrast audit`, async ({ page }) => {
        await page.goto(p.path);
        await p.ready(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const bad = await auditContrast(page);
        expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
      });
    }
  });
}

test("rules: every flow has a chart; picking one draws its end results", async ({ page }) => {
  await page.goto("/rules");
  expect(await page.locator(".fl-item").count()).toBeGreaterThan(10);
  await untilItWorks(async () => {
    await page.getByLabel("Find a flow").fill("MCCP");
    await page.locator(".fl-item").first().click();
  }, async () => { await expect(page.getByRole("heading", { name: /MCCP/ })).toBeVisible({ timeout: 1500 }); });
  await expect(page.locator(".fl-out.ok").first()).toBeVisible();
  await expect(page.locator(".fl-caution").first()).toContainText(/draft/i);
  await page.getByRole("tab", { name: "Error types & sources" }).click();
  await expect(page.getByText(/Unresolved source conflict: Error Type 19/)).toBeVisible();
});

test("rules page fits a 1920×1080 laptop screen without page scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "Judgement Rules" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(overflow).toBeLessThanOrEqual(80);
});

test("settings tabs switch and keep the section in the URL", async ({ page }) => {
  await page.goto("/settings");
  await untilItWorks(() => page.getByRole("tab", { name: /IMDS Tracker/ }).click(), async () => { await expect(page).toHaveURL(/#tracker$/, { timeout: 1500 }); });
  await expect(page.getByRole("link", { name: /Tracker data source/ })).toHaveAttribute("href", "/imds-tracker#settings");
  await page.getByRole("tab", { name: /Judgement/ }).click();
  await expect(page.getByRole("link", { name: /Auto-judge rule families/ })).toHaveAttribute("href", "/judgement?autojudge=settings");
});

test("supplier pre-check shows one tool at a time", async ({ page }) => {
  await page.goto("/supplier-precheck");
  await untilItWorks(() => page.getByRole("tab", { name: /One part by hand/ }).click(),
    async () => { await expect(page.getByText(/Supplier pre-check workspace|Submit a pre-check/)).toBeVisible({ timeout: 1500 }); });
});

test("command palette: Ctrl+K opens it, typing filters, Enter navigates, Esc closes", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("tab", { name: /Judgement/ })).toBeVisible();
  await untilItWorks(() => page.keyboard.press("Control+k"), async () => { await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible({ timeout: 1500 }); });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("judgement rules");
  await expect(page.getByRole("option", { name: /Judgement Rules/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/rules/);
});

test("rules: a case path from the judgement table is highlighted on its flow chart", async ({ page }) => {
  const trail = [["Confirm to supplier", "b · it contains"], ["Vehicle destination", "eu"], ["Is the total of PFOAs below 0.0000025wt% (25ppb) in the material?", "yes"]];
  const enc = Buffer.from(JSON.stringify(trail), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await page.goto(`/rules?flow=pfoa&trail=${enc}&case=TEST-PART`);
  await expect(page.getByRole("heading", { name: /PFOA/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Case path" })).toContainText(/3 steps matched, ends at Judge OK/);
  await expect(page.locator(".fl-out.on-path")).toHaveCount(1);
  await expect(page.locator(".fl-out.on-path")).toContainText("Judge OK");
});

test("rules: the canvas zooms, fits and shows step details", async ({ page }) => {
  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "Judgement Rules" })).toBeVisible();
  const pct = page.locator(".fl-zoom b");
  await untilItWorks(() => page.getByRole("button", { name: "Reset to 100%" }).click(), async () => { await expect(pct).toHaveText("100%", { timeout: 1500 }); });
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(pct).toHaveText("120%");
  await page.locator(".fl-q").first().click();
  await expect(page.getByRole("complementary", { name: "Step details" })).toContainText(/QUESTION/);
});

test("unknown address shows a page-not-found screen with a way back", async ({ page }) => {
  const r = await page.goto("/this-page-does-not-exist");
  expect(r?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.locator(".state-page").getByRole("link", { name: "Judgement register" })).toBeVisible();
});
