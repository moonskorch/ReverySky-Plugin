import { describe, expect, it } from "vitest";
import { getEmbeddedUnityIndexHtml } from "../../src/runtime/EmbeddedUnityIndexHtml";

const embeddedKey = "__REVERYSKY_EMBEDDED_UNITY_INDEX_HTML__";
type GlobalWithEmbeddedKey = typeof globalThis & Record<typeof embeddedKey, unknown>;

function restoreEmbeddedHtml(hadOwnProperty: boolean, previousValue: unknown): void {
  if (hadOwnProperty) {
    (globalThis as GlobalWithEmbeddedKey)[embeddedKey] = previousValue;
    return;
  }

  Reflect.deleteProperty(globalThis, embeddedKey);
}

describe("getEmbeddedUnityIndexHtml", () => {
  it("returns null when the embedded HTML is absent", () => {
    const hadOwnProperty = Object.prototype.hasOwnProperty.call(globalThis, embeddedKey);
    const previousValue = (globalThis as GlobalWithEmbeddedKey)[embeddedKey];

    try {
      Reflect.deleteProperty(globalThis, embeddedKey);
      expect(getEmbeddedUnityIndexHtml()).toBeNull();
    } finally {
      restoreEmbeddedHtml(hadOwnProperty, previousValue);
    }
  });

  it("returns the exact embedded HTML string when present", () => {
    const hadOwnProperty = Object.prototype.hasOwnProperty.call(globalThis, embeddedKey);
    const previousValue = (globalThis as GlobalWithEmbeddedKey)[embeddedKey];
    const html = "<!doctype html><html>embedded</html>";

    try {
      (globalThis as GlobalWithEmbeddedKey)[embeddedKey] = html;
      expect(getEmbeddedUnityIndexHtml()).toBe(html);
    } finally {
      restoreEmbeddedHtml(hadOwnProperty, previousValue);
    }
  });
});
