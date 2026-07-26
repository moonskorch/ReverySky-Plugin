import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

test.use({
  channel: "msedge",
  deviceScaleFactor: 1,
  viewport: {
    width: 584,
    height: 80
  }
});

test.describe("render scale slider", () => {
  test("render-scale-slider", async ({ page }) => {
    const previewPath = path.resolve(process.cwd(), "tests/visual/render-scale-slider.preview.html");
    await page.goto(pathToFileURL(previewPath).href);

    const stage = page.locator("[data-visual-stage]");
    const renderScaleInput = page.locator(".reverysky-map-render-scale-input");

    await expect(renderScaleInput).toHaveValue("1.5");

    await expect(stage).toHaveScreenshot("render-scale-slider.png", {
      animations: "disabled"
    });

    await renderScaleInput.focus();
    await expect(renderScaleInput).toBeFocused();
    await expect(renderScaleInput).toHaveCSS("outline-style", "solid");
  });
});
