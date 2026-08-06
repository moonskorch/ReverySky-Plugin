import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

test.use({
  channel: "msedge",
  deviceScaleFactor: 1,
  viewport: {
    width: 180,
    height: 180
  }
});

test.describe("filter toggle", () => {
  test("filter-toggle-closed", async ({ page }) => {
    const previewPath = path.resolve(process.cwd(), "tests/visual/filter-toggle.preview.html");
    await page.goto(pathToFileURL(previewPath).href);

    const stage = page.locator("[data-visual-stage]");
    const settingsToggle = page.locator(".reverysky-map-settings-toggle");

    await expect(settingsToggle).toHaveAttribute("aria-label", "Open filters");
    await expect(settingsToggle).toBeVisible();

    await expect(stage).toHaveScreenshot("filter-toggle-closed.png", {
      animations: "disabled"
    });
  });
});
