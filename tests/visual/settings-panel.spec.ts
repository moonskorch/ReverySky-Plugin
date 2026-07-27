import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

test.use({
  channel: "msedge",
  deviceScaleFactor: 1,
  viewport: {
    width: 480,
    height: 540
  }
});

test.describe("settings panel", () => {
  test("settings-panel-expanded", async ({ page }) => {
    const previewPath = path.resolve(process.cwd(), "tests/visual/settings-panel.preview.html");
    await page.goto(pathToFileURL(previewPath).href);

    const stage = page.locator("[data-visual-stage]");
    const graphicsSection = page.locator(".reverysky-map-graphics-section");
    const frameRateSelect = page.locator(".reverysky-map-frame-rate-mode-select");
    const closeButton = page.locator(".reverysky-map-filter-close");
    const gearReference = page.locator(".visual-gear-reference .reverysky-map-filter-toggle");

    await expect(graphicsSection).toContainText("Graphics");
    await expect(graphicsSection).toContainText("Render scale");
    await expect(frameRateSelect).toHaveValue("auto");
    await expect(
      page.locator(".reverysky-map-settings-section .reverysky-map-filter-section-toggle")
    ).toHaveCSS("justify-content", "flex-start");

    const closeBox = await closeButton.boundingBox();
    const gearBox = await gearReference.boundingBox();
    expect(closeBox).not.toBeNull();
    expect(gearBox).not.toBeNull();
    expect(Math.abs((closeBox!.x + closeBox!.width / 2) - (gearBox!.x + gearBox!.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs((closeBox!.y + closeBox!.height / 2) - (gearBox!.y + gearBox!.height / 2))).toBeLessThanOrEqual(1);

    await expect(stage).toHaveScreenshot("settings-panel-expanded.png", {
      animations: "disabled"
    });
  });

  test("settings-panel-tab-order", async ({ page }) => {
    const previewPath = path.resolve(process.cwd(), "tests/visual/settings-panel.preview.html");
    await page.goto(pathToFileURL(previewPath).href);

    const focusedControls: string[] = [];
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press("Tab");
      focusedControls.push(
        await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")
      );
    }

    expect(focusedControls).toEqual([
      "Close filters",
      "Search in filter",
      "Toggle tags",
      "Select layout",
      "Render scale",
      "Select frame rate"
    ]);
  });

  test("settings-panel-collapsed", async ({ page }) => {
    const previewPath = path.resolve(process.cwd(), "tests/visual/settings-panel.preview.html");
    await page.goto(pathToFileURL(previewPath).href);

    const stage = page.locator("[data-visual-stage]");
    const settingsToggle = page.locator(
      ".reverysky-map-settings-section .reverysky-map-filter-section-toggle"
    );
    const graphicsToggle = page.locator(
      ".reverysky-map-graphics-section .reverysky-map-filter-section-toggle"
    );

    await settingsToggle.click();
    await graphicsToggle.click();
    await stage.evaluate((element) => {
      element.classList.add("visual-stage--collapsed");
    });

    await expect(settingsToggle).toHaveAttribute("aria-expanded", "false");
    await expect(graphicsToggle).toHaveAttribute("aria-expanded", "false");

    await expect(stage).toHaveScreenshot("settings-panel-collapsed.png", {
      animations: "disabled"
    });
  });

  test("settings-panel-overflow-scrolls-without-visible-scrollbar", async ({ page }) => {
    const previewPath = path.resolve(process.cwd(), "tests/visual/settings-panel.preview.html");
    await page.goto(pathToFileURL(previewPath).href);

    const stage = page.locator("[data-visual-stage]");
    const panel = page.locator(".reverysky-map-filter-panel");
    await stage.evaluate((element) => {
      element.classList.add("visual-stage--compact-overflow");
    });

    await expect(panel).toHaveCSS("overflow-y", "auto");

    const beforeWheel = await panel.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      scrollbarGutter:
        element.offsetWidth -
        element.clientWidth -
        parseFloat(getComputedStyle(element).borderLeftWidth) -
        parseFloat(getComputedStyle(element).borderRightWidth)
    }));
    expect(beforeWheel.scrollHeight).toBeGreaterThan(beforeWheel.clientHeight);
    expect(beforeWheel.scrollbarGutter).toBeLessThanOrEqual(1);

    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    await page.mouse.move(panelBox!.x + 12, panelBox!.y + panelBox!.height - 12);
    await page.mouse.wheel(0, 480);

    await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(beforeWheel.scrollTop);
    const afterWheel = await panel.evaluate((element) => element.scrollTop);
    expect(afterWheel).toBeGreaterThan(beforeWheel.scrollTop);
  });
});
