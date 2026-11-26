import { Workbook } from "exceljs";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext } from "@playwright/test";
import { trackerFixture } from "../components/tracker/fixture-data";
import { auditContrast } from "./contrast";
import { DEFAULT_CONFIG } from "../lib/followup/center";

const legacySource = readFileSync("private/imds-tracker.html", "utf8");
const legacySync = readFileSync("private/shared-master-sync.js", "utf8");
const anchor = "  tryAutoReconnect();\n})();";
const fixtureSource = legacySource.replace(anchor, () => "  tryAutoReconnect();\n" + legacySync + "\n})();")
  .replaceAll("__IMDS_USER_EMAIL__", "fixture@example.invalid")
  .replaceAll("__IMDS_USER_INITIALS__", "FX")
  .replaceAll("__IMDS_USER_ROLE__", "viewer");

async function serveLegacyFixture(context: BrowserContext) {
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "http://localhost:3000") return route.abort();
    if (url.pathname === "/imds-tracker") return route.fulfill({ contentType: "text/html", body: fixtureSource });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (request.method() !== "GET") return route.fulfill({ status: 405, json: { error: "Fixture is read-only." } });
    if (url.pathname === "/api/imds-master/tracker-data") return route.fulfill({ json: trackerFixture.snapshot, headers: { ETag: '"fixture"' } });
    if (url.pathname === "/api/imds-master/settings" && url.searchParams.get("key") === "due_dates") {
      const { version, ...value } = trackerFixture.dueDates;
      return route.fulfill({ json: { version, value } });
    }
    if (url.pathname === "/api/imds-master/settings") return route.fulfill({ json: { exists: true, version: 1, value: url.searchParams.get("key") === "followup_config" ? DEFAULT_CONFIG : null } });
    if (url.pathname === "/api/imds-master/followups") return route.fulfill({ json: { configured: false, canDraft: true, lastSent: {}, role: "viewer" } });
    if (url.pathname === "/api/imds-master/sync") return route.fulfill({ json: { configured: false } });
    return route.fulfill({ json: {} });
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`Tracker 9A compares Overview and Model Tracker in ${theme}`, async ({ page, context }, info) => {
    await serveLegacyFixture(context);
    await context.addInitScript(t => {
      localStorage.setItem("imds-theme", t);
      localStorage.setItem("imds-tracker-theme", t);
    }, theme);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const reactErrors: string[] = [];
    page.on("pageerror", error => reactErrors.push(error.message));
    const legacy = await context.newPage();
    await legacy.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await legacy.setViewportSize({ width: 1440, height: 1000 });
    await legacy.goto("/imds-tracker#overview");
    await expect(legacy.locator(".kpi-value").first()).toHaveText("57%");
    const kpis = await legacy.locator(".kpi-value").allTextContents();
    const modelNames = await legacy.locator(".mcard-name").allTextContents();
    const priorityNames = await legacy.locator(".att-name").allTextContents();
    await legacy.screenshot({ path: info.outputPath(`legacy-overview-${theme}.png`), fullPage: true });

    await page.goto("/tracker-migration/fixture#overview");
    await expect(page.getByText("SYNTHETIC FIXTURE")).toBeVisible();
    await expect(page.locator(".trk-kpi > strong").first()).toHaveText("57%");
    expect(await page.locator(".trk-kpi > strong").allTextContents()).toEqual(kpis);
    expect(await page.locator(".trk-model-card .trk-model-name").allTextContents()).toEqual(modelNames);
    expect(await page.locator(".trk-attention-row .trk-link").allTextContents()).toEqual(priorityNames);
    expect(await auditContrast(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`react-overview-${theme}.png`), fullPage: true });

    await legacy.locator(".mcard").filter({ hasText: "SYNTH-01" }).click();
    await expect(legacy.locator(".detail-title")).toHaveText("SYNTH-01");
    const legacyBreakdown = await legacy.locator(".detail-list tbody tr th button").allTextContents();
    await legacy.screenshot({ path: info.outputPath(`legacy-models-${theme}.png`), fullPage: true });
    await page.locator(".trk-model-card").filter({ hasText: "SYNTH-01" }).click();
    await expect(page).toHaveURL(/#models$/);
    await expect(page.locator(".trk-model-detail-title")).toHaveText("SYNTH-01");
    expect(await page.locator(".trk-supplier-breakdown tbody tr th a").allTextContents()).toEqual(legacyBreakdown);
    expect(await auditContrast(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`react-models-${theme}.png`), fullPage: true });

    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (width === 390) await page.screenshot({ path: info.outputPath(`react-models-${theme}-mobile.png`), fullPage: true });
    }
    await page.getByRole("button", { name: "Show all models" }).click();
    await expect(page.getByRole("heading", { name: "All models" })).toBeVisible();
    expect(reactErrors).toEqual([]);
  });
}

test("legacy handoff applies the selected scope and opens the existing composer without sending", async ({ page, context }) => {
  await serveLegacyFixture(context);
  await page.goto("/imds-tracker?from=tracker-migration&model=SYNTH-01&status=rejected#suppliers");
  await expect(page.locator(".sup-link")).toHaveText(["Fixture Seals"]);
  await page.goto("/imds-tracker?from=tracker-migration&supplier=Fixture%20Seals&action=reminder#followup");
  await expect(page.locator("[data-fmode=email]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#fu-kinds [data-kind=followup]")).toHaveAttribute("aria-pressed", "true");
});

for (const theme of ["light","dark"] as const) {
  test(`Tracker 9B supplier and directory workflows in ${theme}`, async ({page,context},info) => {
    await serveLegacyFixture(context);
    await context.addInitScript(t=>{localStorage.setItem("imds-theme",t);localStorage.setItem("imds-tracker-theme",t);},theme);
    await page.setViewportSize({width:1440,height:1000});
    await page.goto("/imds-tracker#suppliers");
    await expect(page.locator(".sup-link")).toHaveCount(3);
    const names = await page.locator(".sup-link").allTextContents();
    await page.screenshot({path:info.outputPath(`legacy-suppliers-${theme}.png`),fullPage:true});
    await page.goto("/tracker-migration/fixture#suppliers");
    const suppliers = page.getByRole("table",{name:"Supplier progress"});
    await expect(suppliers.getByRole("button")).toHaveText(names);
    await page.screenshot({path:info.outputPath(`react-suppliers-${theme}.png`),fullPage:true});
    await page.getByRole("button",{name:/^Rejected/}).click();
    await expect(suppliers.getByRole("button")).toHaveCount(1);
    await suppliers.getByRole("button",{name:"Fixture Seals"}).click();
    await expect(page.getByRole("dialog")).toContainText("FIX-201");
    await page.keyboard.press("Escape");
    await expect(suppliers.getByRole("button",{name:"Fixture Seals"})).toBeFocused();
    await page.goto("/tracker-migration/fixture#directory");
    await expect(page.getByRole("heading",{name:"Fixture Seals"})).toBeVisible();
    await page.getByRole("button",{name:"PUD buyers",exact:true}).click();
    await expect(page.getByRole("cell",{name:"Synthetic Buyer"})).toBeVisible();
    await page.getByRole("button",{name:"Tracker match",exact:true}).click();
    await expect(page.getByRole("row").filter({hasText:"Fixture Seals"})).toContainText("code");
    await page.screenshot({path:info.outputPath(`react-directory-${theme}.png`),fullPage:true});
    const backupPromise = page.waitForEvent("download");
    await page.getByRole("button",{name:"Download backup"}).click();
    const backup = await backupPromise;
    const json = JSON.parse(readFileSync((await backup.path())!,"utf8"));
    expect(json.entries["FIXTURE SEALS"].f.pic1_email).toBe("fixture@example.invalid");
    expect(json.app).toBe("imds-tracker-directory");
    const workbookPromise = page.waitForEvent("download");
    await page.getByRole("button",{name:"Export Excel"}).click();
    const workbook = new Workbook();
    await workbook.xlsx.readFile((await (await workbookPromise).path())!);
    expect(workbook.getWorksheet("Directory")?.getCell("C2").value).toBe("Synthetic Buyer");
    await page.setViewportSize({width:390,height:844});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
}
