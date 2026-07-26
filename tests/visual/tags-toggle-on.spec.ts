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

test.describe("tags toggle on", () => {
  test("tags-toggle-on", async ({ page }) => {
    const previewPath = path.resolve(process.cwd(), "tests/visual/tags-toggle-on.preview.html");
    await page.goto(pathToFileURL(previewPath).href);

    const stage = page.locator("[data-visual-stage]");
    const tagsToggle = page.locator(".reverysky-map-tags-toggle");

    await expect(tagsToggle).toHaveAttribute("aria-checked", "true");

    await expect(stage).toHaveScreenshot("tags-toggle-on.png", {
      animations: "disabled"
    });

    await page.keyboard.press("Tab");
    await expect(tagsToggle).toBeFocused();
    await expect(tagsToggle).not.toHaveCSS("box-shadow", "none");
  });
});
