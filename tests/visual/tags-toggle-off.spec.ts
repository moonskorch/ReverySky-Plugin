import { expect, test } from "@playwright/test";
import fs from "node:fs";
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

test.describe("tags toggle off", () => {
  test("tags-toggle-off", async ({ page }) => {
    const previewPath = path.resolve(
      process.cwd(),
      "tests/visual/tags-toggle-off.preview.html"
    );

    await page.goto(pathToFileURL(previewPath).href);

    const stage = page.locator("[data-visual-stage]");
    const tagsToggle = page.locator(".reverysky-map-tags-toggle");

    await expect(tagsToggle).toHaveAttribute("aria-checked", "false");

    await expect(stage).toHaveScreenshot("tags-toggle-off.png", {
      animations: "disabled"
    });
  });
});
