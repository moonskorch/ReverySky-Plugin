import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

test.use({
  channel: "msedge",
  deviceScaleFactor: 1,
  viewport: {
    width: 480,
    height: 780
  }
});

test.describe("settings panel", () => {
  test("settings-panel-expanded", async ({ page }) => {
    const previewPath = path.resolve(process.cwd(), "tests/visual/settings-panel.preview.html");
    await page.goto(pathToFileURL(previewPath).href);

    const stage = page.locator("[data-visual-stage]");
    const selectionSection = page.locator(".reverysky-map-selection-section");
    const selectionContent = page.locator(
      ".reverysky-map-selection-section > .reverysky-map-settings-section-content"
    );
    const selectionToggle = page.locator(
      ".reverysky-map-selection-section .reverysky-map-settings-section-toggle"
    );
    const egoSection = page.locator(".reverysky-map-ego-section");
    const egoToggle = page.locator(".reverysky-map-ego-section .reverysky-map-settings-section-toggle");
    const egoHelpLink = page.locator(".reverysky-map-ego-section .reverysky-map-settings-help-link");
    const graphicsSection = page.locator(".reverysky-map-graphics-section");
    const graphicsToggle = page.locator(".reverysky-map-graphics-section .reverysky-map-settings-section-toggle");
    const graphicsHelpLink = page.locator(".reverysky-map-graphics-section .reverysky-map-settings-help-link");
    const screenshotSection = page.locator(".reverysky-map-screenshot-section");
    const screenshotToggle = page.locator(
      ".reverysky-map-screenshot-section .reverysky-map-settings-section-toggle"
    );
    const screenshotHelpLink = page.locator(".reverysky-map-screenshot-section .reverysky-map-settings-help-link");
    const screenshotButton = page.locator(".reverysky-map-screenshot-button");
    const frameRateSelect = page.locator(".reverysky-map-frame-rate-mode-select");
    const closeButton = page.locator(".reverysky-map-settings-close");
    const gearReference = page.locator(".visual-gear-reference .reverysky-map-settings-toggle");

    await egoToggle.evaluate((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    });
    await expect(egoSection).toContainText("Ego Graph");
    await expect(egoSection).toContainText("Depth");
    await expect(egoSection).toContainText("Neighbor links");
    await expect(egoToggle).toHaveAttribute("aria-expanded", "true");
    await expect(graphicsSection).toContainText("Graphics");
    await expect(graphicsSection).toContainText("Render scale");
    await screenshotToggle.evaluate((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    });
    await expect(screenshotSection).toContainText("Screenshot");
    await expect(screenshotButton).toHaveText("Copy screenshot");
    await expect(selectionToggle).toHaveAttribute("aria-expanded", "true");
    await expect(screenshotToggle).toHaveAttribute("aria-expanded", "true");
    await expect(graphicsToggle).toHaveAttribute("aria-expanded", "true");
    await expect(egoHelpLink).toBeVisible();
    await expect(graphicsHelpLink).toBeVisible();
    await expect(screenshotHelpLink).toBeVisible();
    await expect(frameRateSelect).toHaveValue("auto");
    await expect(
      page.locator(".reverysky-map-selection-section .reverysky-map-settings-section-toggle")
    ).toHaveCSS("justify-content", "flex-start");
    await expect(selectionContent).toHaveCSS("padding-bottom", "10px");
    await expect(selectionSection).toHaveCSS("padding-bottom", await egoSection.evaluate((element) => {
      return getComputedStyle(element).paddingBottom;
    }));

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
    await page.locator(".reverysky-map-ego-section .reverysky-map-settings-section-toggle").evaluate((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    });
    await page.locator(".reverysky-map-screenshot-section .reverysky-map-settings-section-toggle").evaluate((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    });
    for (let step = 0; step < 13; step += 1) {
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
      "Open Ego Graph documentation",
      "Toggle Ego mode",
      "Ego Graph depth",
      "Toggle neighbor links",
      "Open Graphics documentation",
      "Render scale",
      "Select frame rate",
      "Open Screenshot documentation",
      "Copy graph screenshot"
    ]);
  });

  test("settings-panel-collapsed", async ({ page }) => {
    const previewPath = path.resolve(process.cwd(), "tests/visual/settings-panel.preview.html");
    await page.goto(pathToFileURL(previewPath).href);

    const stage = page.locator("[data-visual-stage]");
    const selectionSection = page.locator(".reverysky-map-selection-section");
    const settingsToggle = page.locator(
      ".reverysky-map-selection-section .reverysky-map-settings-section-toggle"
    );
    const egoToggle = page.locator(
      ".reverysky-map-ego-section .reverysky-map-settings-section-toggle"
    );
    const graphicsToggle = page.locator(
      ".reverysky-map-graphics-section .reverysky-map-settings-section-toggle"
    );
    const screenshotToggle = page.locator(
      ".reverysky-map-screenshot-section .reverysky-map-settings-section-toggle"
    );
    const egoSection = page.locator(".reverysky-map-ego-section");
    const screenshotSection = page.locator(".reverysky-map-screenshot-section");
    const screenshotButton = page.locator(".reverysky-map-screenshot-button");
    const egoDepthInput = page.locator(".reverysky-map-ego-depth-input");
    const egoHelpLink = page.locator(".reverysky-map-ego-section .reverysky-map-settings-help-link");
    const graphicsHelpLink = page.locator(".reverysky-map-graphics-section .reverysky-map-settings-help-link");
    const screenshotHelpLink = page.locator(".reverysky-map-screenshot-section .reverysky-map-settings-help-link");

    await settingsToggle.click();
    await graphicsToggle.click();
    await stage.evaluate((element) => {
      element.classList.add("visual-stage--collapsed");
    });

    await expect(settingsToggle).toHaveAttribute("aria-expanded", "false");
    await expect(egoToggle).toHaveAttribute("aria-expanded", "false");
    await expect(graphicsToggle).toHaveAttribute("aria-expanded", "false");
    await expect(screenshotToggle).toHaveAttribute("aria-expanded", "false");
    await expect(egoSection).toContainText("Ego Graph");
    await expect(egoDepthInput).not.toBeVisible();
    await expect(screenshotSection).toContainText("Screenshot");
    await expect(screenshotButton).not.toBeVisible();
    await expect(egoHelpLink).not.toBeVisible();
    await expect(graphicsHelpLink).not.toBeVisible();
    await expect(screenshotHelpLink).not.toBeVisible();
    await expect(selectionSection).toHaveCSS("padding-bottom", await egoSection.evaluate((element) => {
      return getComputedStyle(element).paddingBottom;
    }));

    await expect(stage).toHaveScreenshot("settings-panel-collapsed.png", {
      animations: "disabled"
    });
  });

  test("settings-panel-overflow-scrolls-without-visible-scrollbar", async ({ page }) => {
    const previewPath = path.resolve(process.cwd(), "tests/visual/settings-panel.preview.html");
    await page.goto(pathToFileURL(previewPath).href);

    const stage = page.locator("[data-visual-stage]");
    const panel = page.locator(".reverysky-map-settings-panel");
    const panelBody = page.locator(".reverysky-map-settings-panel-body");
    await stage.evaluate((element) => {
      element.classList.add("visual-stage--compact-overflow");
    });

    await expect(panelBody).toHaveCSS("overflow-y", "auto");

    const beforeWheel = await panelBody.evaluate((element) => {
      const htmlElement = element as HTMLElement;

      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        scrollbarGutter:
          htmlElement.offsetWidth -
          htmlElement.clientWidth -
          parseFloat(getComputedStyle(htmlElement).borderLeftWidth) -
          parseFloat(getComputedStyle(htmlElement).borderRightWidth)
      };
    });
    expect(beforeWheel.scrollHeight).toBeGreaterThan(beforeWheel.clientHeight);
    expect(beforeWheel.scrollbarGutter).toBeLessThanOrEqual(1);

    const panelBodyBox = await panelBody.boundingBox();
    expect(panelBodyBox).not.toBeNull();
    await page.mouse.move(panelBodyBox!.x + 12, panelBodyBox!.y + panelBodyBox!.height - 12);
    await page.mouse.wheel(0, 480);

    await expect.poll(() => panelBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(beforeWheel.scrollTop);
    const afterWheel = await panelBody.evaluate((element) => element.scrollTop);
    expect(afterWheel).toBeGreaterThan(beforeWheel.scrollTop);
  });
});
