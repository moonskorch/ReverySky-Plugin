import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  selectWhatsNewFile,
  resolveWhatsNewRuntimePaths
} from "../../scripts/whats-new-selection.mjs";

describe("selectWhatsNewFile", () => {
  it("selects the latest version that does not exceed the release version", () => {
    expect(selectWhatsNewFile("1.5.2", [
      "1.5.0.md",
      "1.6.0.md",
      "notes.txt"
    ])).toMatchObject({
      fileName: "1.5.0.md",
      version: "1.5.0"
    });
  });

  it("compares semantic versions numerically", () => {
    expect(selectWhatsNewFile("1.10.0", [
      "1.9.0.md",
      "1.10.0.md"
    ])).toMatchObject({
      fileName: "1.10.0.md",
      version: "1.10.0"
    });
  });

  it("returns null when no announcement is eligible for the release", () => {
    expect(selectWhatsNewFile("1.4.0", [
      "1.5.0.md"
    ])).toBeNull();
  });

  it("rejects release versions outside x.y.z", () => {
    expect(() => selectWhatsNewFile("1.5", ["1.5.0.md"])).toThrow(/x\.y\.z/);
  });

  it("selects the runtime source and target paths from manifest metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "reverysky-whats-new-selection-"));
    try {
      const manifestPath = path.join(root, "manifest.json");
      const whatsNewDir = path.join(root, "whats-new");
      await mkdir(whatsNewDir, { recursive: true });
      await writeFile(manifestPath, JSON.stringify({ version: "1.5.2" }), "utf8");
      await writeFile(path.join(whatsNewDir, "1.5.0.md"), "# Previous\n", "utf8");
      await writeFile(path.join(whatsNewDir, "1.6.0.md"), "# Future\n", "utf8");

      await expect(resolveWhatsNewRuntimePaths(manifestPath, whatsNewDir)).resolves.toEqual({
        sourcePath: path.join(whatsNewDir, "1.5.0.md"),
        runtimePath: "whats-new/1.5.0.md"
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
