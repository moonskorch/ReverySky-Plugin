import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

test.use({
  channel: "msedge",
  deviceScaleFactor: 1,
  viewport: {
    width: 480,
    height: 400
  }
});

test.describe("layout dropdown", () => {
  test("map-layout-dropdown-focused", async ({ page }) => {
    const previewPath = path.resolve(process.cwd(), "tests/visual/engine-dropdown.preview.html");
    await page.goto(pathToFileURL(previewPath).href);

    const stage = page.locator("[data-visual-stage]");
    const engineSelect = page.locator(".reverysky-map-engine-select");

    await expect(engineSelect).toHaveValue("auto");

    // Native select popups are browser UI, so the open list itself is not captured
    // deterministically in this headless visual harness. We snapshot the closed
    // field with hover/focus styling instead.
    await engineSelect.hover();
    await engineSelect.focus();

    await expect(stage).toHaveScreenshot("engine-dropdown-focused.png", {
      animations: "disabled"
    });
  });
});
