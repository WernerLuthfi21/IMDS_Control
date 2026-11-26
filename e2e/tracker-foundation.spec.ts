import {test,expect} from "@playwright/test";
for(const theme of ["light","dark"] as const){
 test("Tracker fixture: "+theme+" tabs, draft and shell",async({page},info)=>{
  await page.addInitScript(t=>{localStorage.setItem("imds-theme","light");localStorage.setItem("imds-tracker-theme",t);},theme);
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto("/tracker-migration/fixture");
  const shell=page.locator("[data-tracker-shell]");
  await expect(shell).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-tracker-theme",theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme","light");
  await expect(shell).toHaveCSS("color",theme==="dark"?"rgb(238, 233, 247)":"rgb(33, 26, 43)");
  await expect(page.locator(".trk-mascot .cube")).toHaveCount(3);
  await expect(page.getByRole("navigation",{name:"Main"}).getByRole("link")).toHaveCount(9);
  await page.getByRole("navigation",{name:"Main"}).getByRole("link",{name:"Settings"}).click();
  await page.getByRole("tab",{name:/Templates/}).click();
  await page.getByLabel("Message preview").fill("Keep this draft");
  await page.getByLabel("Tracker appearance").selectOption(theme==="dark"?"light":"dark");
  await expect(page.locator("html")).toHaveAttribute("data-tracker-theme",theme==="dark"?"light":"dark");
  await expect(page.getByLabel("Message preview")).toHaveValue("Keep this draft");
  await page.getByRole("tab",{name:/Data source/}).click();
  await page.getByRole("button",{name:"Open confirmation"}).click();
  await expect(page.getByRole("dialog",{name:"Fixture confirmation"})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status").filter({hasText:"Cancelled fixture"})).toBeVisible();
  await page.getByRole("navigation",{name:"Main"}).getByRole("link",{name:"Settings"}).click();
  await expect(page.getByRole("heading",{name:"Settings",exact:true})).toBeVisible();
  await page.getByLabel("Tracker appearance").selectOption(theme);
  await page.screenshot({path:info.outputPath("tracker-"+theme+".png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 });
}
test("Tracker system preference follows OS without modifying Judgement",async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem("imds-theme","dark");localStorage.setItem("imds-tracker-theme","system");});
 await page.emulateMedia({colorScheme:"light",reducedMotion:"reduce"});
 await page.goto("/tracker-migration/fixture");
 await expect(page.locator("html")).toHaveAttribute("data-tracker-theme","light");
 await expect(page.getByLabel("Tracker appearance")).toHaveValue("system");
 await page.emulateMedia({colorScheme:"dark"});
 await expect(page.locator("html")).toHaveAttribute("data-tracker-theme","dark");
 await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 await page.goto("/settings");
 await expect(page.locator("[data-tracker-shell]")).toHaveCount(0);
});
test("unconfigured server cannot render protected migration workspace",async({page})=>{
 await page.goto("/tracker-migration");
 await expect(page.getByText("Tracker migration is unavailable until authentication is configured.")).toBeVisible();
 await expect(page.getByRole("region",{name:"Tracker migration foundation"})).toHaveCount(0);
});
test("first paint uses the legacy preference before React hydration", async ({ page }) => {
 await page.emulateMedia({ colorScheme: "light" });
 await page.addInitScript(() => localStorage.setItem("imds-theme", "dark"));
 await page.route("**/_next/static/**/*.js*", route => route.abort());
 await page.goto("/tracker-migration/fixture#settings");
 await expect(page.locator("html")).toHaveAttribute("data-tracker-theme", "dark");
 await expect(page.locator("[data-tracker-shell]")).toHaveCSS("color", "rgb(238, 233, 247)");
});
test("skip to content keeps the current Tracker view", async ({ page }) => {
 await page.goto("/tracker-migration/fixture#settings");
 await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
 await page.keyboard.press("Tab");
 await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
 await page.keyboard.press("Enter");
 await expect(page.locator("#main-content")).toBeFocused();
 await expect(page).toHaveURL(/#settings$/);
});
