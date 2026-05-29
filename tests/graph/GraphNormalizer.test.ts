import { describe, expect, it } from "vitest";
import { GraphNormalizer } from "../../src/graph/GraphNormalizer";

describe("GraphNormalizer", () => {
  it("normalizes Windows path separators to slash", () => {
    expect(GraphNormalizer.normalizePath("Folder\\Sub\\Note.md")).toBe("Folder/Sub/Note.md");
  });

  it("normalizes single tag by trimming and removing heading hash", () => {
    expect(GraphNormalizer.normalizeTag("  #space  ")).toBe("space");
    expect(GraphNormalizer.normalizeTag("plain")).toBe("plain");
  });

  it("normalizes tag list by removing empty values and duplicates", () => {
    const normalized = GraphNormalizer.normalizeTags(["#alpha", " alpha ", "", "   ", "#beta", "#alpha"]);
    expect(normalized).toEqual(["alpha", "beta"]);
  });
});
