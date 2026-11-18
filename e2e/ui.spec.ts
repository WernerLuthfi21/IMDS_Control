import { expect, test, type Page } from "@playwright/test";
import { auditContrast } from "./contrast";

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
  await page.getByLabel("Find a flow").fill("MCCP");
  await page.locator(".fl-item").first().click();
  await expect(page.getByRole("heading", { name: /MCCP/ })).toBeVisible();
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
  await page.getByRole("tab", { name: /IMDS Tracker/ }).click();
  await expect(page).toHaveURL(/#tracker$/);
  await expect(page.getByRole("link", { name: /Tracker data source/ })).toHaveAttribute("href", "/imds-tracker#settings");
  await page.getByRole("tab", { name: /Judgement/ }).click();
  await expect(page.getByRole("link", { name: /Auto-judge rule families/ })).toHaveAttribute("href", "/judgement?autojudge=settings");
});

test("supplier pre-check shows one tool at a time", async ({ page }) => {
  await page.goto("/supplier-precheck");
  await page.getByRole("tab", { name: /One part by hand/ }).click();
  await expect(page.getByText(/Supplier pre-check workspace|Submit a pre-check/)).toBeVisible();
});
