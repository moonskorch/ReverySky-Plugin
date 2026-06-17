import { describe, expect, it } from "vitest";
import { getEmbeddedUnityIndexHtml } from "../../src/runtime/EmbeddedUnityIndexHtml";

const embeddedKey = "__REVERYSKY_EMBEDDED_UNITY_INDEX_HTML__";
type WindowWithEmbeddedKey = Window & Record<typeof embeddedKey, unknown>;

function restoreEmbeddedHtml(hadOwnProperty: boolean, previousValue: unknown): void {
  if (hadOwnProperty) {
    (window as WindowWithEmbeddedKey)[embeddedKey] = previousValue;
    return;
  }

  Reflect.deleteProperty(window, embeddedKey);
}

describe("getEmbeddedUnityIndexHtml", () => {
  it("returns null when the embedded HTML is absent", () => {
    const hadOwnProperty = Object.prototype.hasOwnProperty.call(window, embeddedKey);
    const previousValue = (window as WindowWithEmbeddedKey)[embeddedKey];

    try {
      Reflect.deleteProperty(window, embeddedKey);
      expect(getEmbeddedUnityIndexHtml()).toBeNull();
    } finally {
      restoreEmbeddedHtml(hadOwnProperty, previousValue);
    }
  });

  it("returns the exact embedded HTML string when present", () => {
    const hadOwnProperty = Object.prototype.hasOwnProperty.call(window, embeddedKey);
    const previousValue = (window as WindowWithEmbeddedKey)[embeddedKey];
    const html = "<!doctype html><html>embedded</html>";

    try {
      (window as WindowWithEmbeddedKey)[embeddedKey] = html;
      expect(getEmbeddedUnityIndexHtml()).toBe(html);
    } finally {
      restoreEmbeddedHtml(hadOwnProperty, previousValue);
    }
  });
});
