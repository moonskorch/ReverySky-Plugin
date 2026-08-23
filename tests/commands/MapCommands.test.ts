import { describe, expect, it } from "vitest";
import {
  addLandmarkToFrontmatter,
  normalizeLandmarkSelection
} from "../../src/commands/MapCommands";

describe("normalizeLandmarkSelection", () => {
  it("collapses whitespace and limits landmarks to 50 characters", () => {
    expect(normalizeLandmarkSelection("  The\nancient\tcity   gate with a very long descriptive suffix  ")).toBe(
      "The ancient city gate with a very long descriptive"
    );
  });

  it("returns an empty string for whitespace-only selections", () => {
    expect(normalizeLandmarkSelection(" \n\t ")).toBe("");
  });
});

describe("addLandmarkToFrontmatter", () => {
  it("creates landmarks when the field is missing", () => {
    const frontmatter: Record<string, unknown> = {};

    addLandmarkToFrontmatter(frontmatter, "Sky Garden");

    expect(frontmatter.landmarks).toEqual(["Sky Garden"]);
  });

  it("appends a new landmark without duplicating an existing one", () => {
    const frontmatter: Record<string, unknown> = {
      landmarks: ["Sky Garden"]
    };

    addLandmarkToFrontmatter(frontmatter, "Moon Bridge");
    addLandmarkToFrontmatter(frontmatter, "Sky Garden");

    expect(frontmatter.landmarks).toEqual(["Sky Garden", "Moon Bridge"]);
  });

  it("leaves non-array landmarks unchanged", () => {
    const frontmatter: Record<string, unknown> = {
      landmarks: "Sky Garden"
    };

    addLandmarkToFrontmatter(frontmatter, "Moon Bridge");

    expect(frontmatter.landmarks).toBe("Sky Garden");
  });
});
