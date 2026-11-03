import { expect, test } from "@playwright/test";
test("dashboard loads and exposes governance warnings", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  await expect(page.getByText("Error Type 19 conflict")).toBeVisible();
});
test("substance search route loads", async ({ page }) => {
  await page.goto("/substances");
  await expect(page.getByRole("heading", { name: "Substance Intelligence" })).toBeVisible();
});
