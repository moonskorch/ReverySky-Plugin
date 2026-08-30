import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readWhatsNewFile, shouldShowWhatsNew } from "../../src/runtime/WhatsNewFile";

async function withRuntimeDir<T>(fn: (runtimeDir: string) => Promise<T>): Promise<T> {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "reverysky-whats-new-"));
  try {
    return await fn(runtimeDir);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
}

describe("readWhatsNewFile", () => {
  it("returns null when no What's New directory exists", async () => {
    await withRuntimeDir(async (runtimeDir) => {
      await expect(readWhatsNewFile(runtimeDir)).resolves.toBeNull();
    });
  });

  it("reads the What's New Markdown file", async () => {
    await withRuntimeDir(async (runtimeDir) => {
      await mkdir(path.join(runtimeDir, "whats-new"), { recursive: true });
      await writeFile(path.join(runtimeDir, "whats-new", "1.4.1.md"), "# Hello\n", "utf8");

      await expect(readWhatsNewFile(runtimeDir)).resolves.toEqual({
        version: "1.4.1",
        markdown: "# Hello\n",
        sourcePath: "whats-new/1.4.1.md"
      });
    });
  });

  it("reads the latest valid What's New Markdown file when several are present", async () => {
    await withRuntimeDir(async (runtimeDir) => {
      await mkdir(path.join(runtimeDir, "whats-new"), { recursive: true });
      await writeFile(path.join(runtimeDir, "whats-new", "1.4.1.md"), "# One\n", "utf8");
      await writeFile(path.join(runtimeDir, "whats-new", "1.4.2.md"), "# Two\n", "utf8");

      await expect(readWhatsNewFile(runtimeDir)).resolves.toEqual({
        version: "1.4.2",
        markdown: "# Two\n",
        sourcePath: "whats-new/1.4.2.md"
      });
    });
  });

  it("returns null when the What's New path cannot be read as a directory", async () => {
    await withRuntimeDir(async (runtimeDir) => {
      await writeFile(path.join(runtimeDir, "whats-new"), "not a directory\n", "utf8");

      await expect(readWhatsNewFile(runtimeDir)).resolves.toBeNull();
    });
  });
});

describe("shouldShowWhatsNew", () => {
  it("shows a packaged announcement when no version was shown before", () => {
    expect(shouldShowWhatsNew("1.4.1", null)).toBe(true);
  });

  it("does not show the same packaged announcement twice", () => {
    expect(shouldShowWhatsNew("1.4.1", "1.4.1")).toBe(false);
  });

  it("shows newer announcements after skipped plugin versions", () => {
    expect(shouldShowWhatsNew("1.5.0", "1.3.2")).toBe(true);
  });

  it("compares semantic versions numerically", () => {
    expect(shouldShowWhatsNew("1.10.0", "1.9.9")).toBe(true);
    expect(shouldShowWhatsNew("1.9.9", "1.10.0")).toBe(false);
  });

  it("does not show older announcements after rollback or downgrade", () => {
    expect(shouldShowWhatsNew("1.4.1", "1.5.0")).toBe(false);
  });

  it("shows when persisted data contains an invalid shown version", () => {
    expect(shouldShowWhatsNew("1.4.1", "legacy")).toBe(true);
  });

  it("does not show invalid packaged announcement versions", () => {
    expect(shouldShowWhatsNew("1.4", null)).toBe(false);
  });
});
