import { expect, test } from "@playwright/test";
import path from "path";
import { pathToFileURL } from "url";

test.use({
  channel: "msedge",
  deviceScaleFactor: 1,
  viewport: {
    width: 520,
    height: 560
  }
});

test.describe("filter suggestions", () => {
  const previewPath = path.resolve(process.cwd(), "tests/visual/filter-suggestions.preview.html");

  test("filter-suggestions-open", async ({ page }) => {
    await page.goto(pathToFileURL(previewPath).href);

    const stage = page.locator("[data-visual-stage]");
    const panel = page.locator(".reverysky-map-filter-panel");
    const suggestions = page.locator(".reverysky-map-filter-suggestions");

    await expect(suggestions).toContainText("Date presets");
    await expect(suggestions).toContainText("date:>=2025-08-01");
    await expect(suggestions).toHaveCSS("overflow-y", "auto");

    const panelBox = await panel.boundingBox();
    const anchorBox = await page.locator("[data-suggestions-anchor]").boundingBox();
    const suggestionsBox = await suggestions.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(anchorBox).not.toBeNull();
    expect(suggestionsBox).not.toBeNull();
    expect(Math.abs(suggestionsBox!.width - anchorBox!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(suggestionsBox!.x + suggestionsBox!.width - (anchorBox!.x + anchorBox!.width))).toBeLessThanOrEqual(1);
    expect(suggestionsBox!.y).toBeGreaterThan(anchorBox!.y + anchorBox!.height);
    expect(suggestionsBox!.y + suggestionsBox!.height).toBeGreaterThan(panelBox!.y + panelBox!.height + 24);

    const suggestionsMetrics = await suggestions.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }));
    expect(suggestionsMetrics.scrollHeight).toBeLessThanOrEqual(suggestionsMetrics.clientHeight + 1);

    const isInsidePanel = await suggestions.evaluate((element) => {
      const panelElement = document.querySelector(".reverysky-map-filter-panel");
      return panelElement?.contains(element) ?? false;
    });
    expect(isInsidePanel).toBe(false);

    await expect(stage).toHaveScreenshot("filter-suggestions-open.png", {
      animations: "disabled"
    });
  });

  test("filter-suggestions-scroll-when-content-overflows", async ({ page }) => {
    await page.goto(pathToFileURL(previewPath).href);

    const suggestions = page.locator("[data-filter-suggestions]");
    await suggestions.evaluate((element) => {
      const datePresets = [
        ["date:2026-06-01", "= two months ago"],
        ["date:>=2026-05-01", ">= three months ago"],
        ["date:>=2026-04-01", ">= four months ago"],
        ["date:>=2026-03-01", ">= five months ago"],
        ["date:>=2026-02-01", ">= six months ago"],
        ["date:>=2026-01-01", ">= seven months ago"],
        ["date:>=2025-12-01", ">= eight months ago"],
        ["date:>=2025-11-01", ">= nine months ago"]
      ];

      for (const [value, label] of datePresets) {
        const option = document.createElement("div");
        option.className = "reverysky-map-date-suggestion-option";
        option.setAttribute("role", "button");
        const valuePart = document.createElement("span");
        valuePart.className = "reverysky-map-date-suggestion-value";
        valuePart.textContent = value;
        const labelPart = document.createElement("span");
        labelPart.className = "reverysky-map-date-suggestion-label";
        labelPart.textContent = label;
        option.append(valuePart, labelPart);
        element.appendChild(option);
      }
    });

    const suggestionsMetrics = await suggestions.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }));
    expect(suggestionsMetrics.scrollHeight).toBeGreaterThan(suggestionsMetrics.clientHeight);
  });

  test("filter-suggestions-match-input-width-when-input-is-compressed", async ({ page }) => {
    await page.goto(pathToFileURL(previewPath).href);

    await page.locator("[data-visual-stage]").evaluate((stage) => {
      (stage as HTMLElement).style.width = "260px";

      const root = document.querySelector(".reverysky-map-root");
      const anchor = document.querySelector("[data-suggestions-anchor]");
      const suggestions = document.querySelector("[data-filter-suggestions]") as HTMLElement | null;
      if (!root || !anchor || !suggestions) {
        throw new Error("Filter suggestions preview markup is incomplete.");
      }

      const anchorRect = anchor.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      suggestions.style.left = "auto";
      suggestions.style.right = `${rootRect.right - anchorRect.right}px`;
      suggestions.style.top = `${anchorRect.bottom - rootRect.top + 4}px`;
      suggestions.style.setProperty("--reverysky-filter-suggestions-anchor-width", `${anchorRect.width}px`);
    });

    const anchorBox = await page.locator("[data-suggestions-anchor]").boundingBox();
    const suggestionsBox = await page.locator("[data-filter-suggestions]").boundingBox();
    expect(anchorBox).not.toBeNull();
    expect(suggestionsBox).not.toBeNull();
    expect(Math.abs(suggestionsBox!.width - anchorBox!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(suggestionsBox!.x + suggestionsBox!.width - (anchorBox!.x + anchorBox!.width))).toBeLessThanOrEqual(1);
  });

  test("webgl-host-stays-fixed-while-filter-panel-scrolls", async ({ page }) => {
    await page.goto(pathToFileURL(previewPath).href);

    const root = page.locator(".reverysky-map-root");
    const host = page.locator("[data-webgl-host]");
    const panel = page.locator(".reverysky-map-filter-panel");
    const suggestions = page.locator("[data-filter-suggestions]");
    const beforeBox = await host.boundingBox();
    expect(beforeBox).not.toBeNull();

    await suggestions.evaluate((element) => {
      const datePresets = Array.from({ length: 18 }, (_value, index) => [
        `date:>=2026-${String(Math.max(1, 8 - index)).padStart(2, "0")}-01`,
        `>= overflow preset ${index + 1}`
      ]);

      for (const [value, label] of datePresets) {
        const option = document.createElement("div");
        option.className = "reverysky-map-date-suggestion-option";
        option.setAttribute("role", "option");
        const valuePart = document.createElement("span");
        valuePart.className = "reverysky-map-date-suggestion-value";
        valuePart.textContent = value;
        const labelPart = document.createElement("span");
        labelPart.className = "reverysky-map-date-suggestion-label";
        labelPart.textContent = label;
        option.append(valuePart, labelPart);
        element.appendChild(option);
      }

      element.scrollTop = element.scrollHeight;
    });

    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    const afterBox = await host.boundingBox();
    expect(afterBox).not.toBeNull();
    expect(afterBox!.x).toBe(beforeBox!.x);
    expect(afterBox!.y).toBe(beforeBox!.y);
    expect(afterBox!.width).toBe(beforeBox!.width);
    expect(afterBox!.height).toBe(beforeBox!.height);
    await expect.poll(() => root.evaluate((element) => element.scrollTop)).toBe(0);
  });
});
