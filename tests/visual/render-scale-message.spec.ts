import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

test.use({
  channel: "msedge",
  deviceScaleFactor: 1,
  viewport: {
    width: 432,
    height: 240
  }
});

test.describe("render scale message", () => {
  test("render-scale-message-with-frame-rate", async ({ page }) => {
    const previewPath = path.resolve(process.cwd(), "tests/visual/render-scale-message.preview.html");
    await page.goto(pathToFileURL(previewPath).href);

    const stage = page.locator("[data-visual-stage]");
    const renderScaleMessage = page.locator(".reverysky-map-render-scale-message");
    const frameRateSelect = page.locator(".reverysky-map-frame-rate-mode-select");

    await expect(renderScaleMessage).toContainText("Reopen the graph view to apply.");
    await expect(frameRateSelect).toHaveValue("auto");

    await expect(stage).toHaveScreenshot("render-scale-message-with-frame-rate.png", {
      animations: "disabled"
    });
  });
});
