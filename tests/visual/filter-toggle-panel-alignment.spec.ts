import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

test.use({
  channel: "msedge",
  deviceScaleFactor: 1,
  viewport: {
    width: 420,
    height: 240
  }
});

test.describe("filter toggle panel alignment", () => {
  test("filter-toggle-over-panel-close", async ({ page }) => {
    const previewPath = path.resolve(
      process.cwd(),
      "tests/visual/filter-toggle-panel-alignment.preview.html"
    );
    await page.goto(pathToFileURL(previewPath).href);

    const stage = page.locator("[data-visual-stage]");
    const filterToggle = page.locator(".reverysky-map-filter-toggle");
    const closeButton = page.locator(".reverysky-map-filter-close");

    const filterToggleBox = await filterToggle.boundingBox();
    const closeBox = await closeButton.boundingBox();
    expect(filterToggleBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect(
      Math.abs((filterToggleBox!.x + filterToggleBox!.width / 2) - (closeBox!.x + closeBox!.width / 2))
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((filterToggleBox!.y + filterToggleBox!.height / 2) - (closeBox!.y + closeBox!.height / 2))
    ).toBeLessThanOrEqual(1);

    await expect(stage).toHaveScreenshot("filter-toggle-over-panel-close.png", {
      animations: "disabled"
    });
  });
});
