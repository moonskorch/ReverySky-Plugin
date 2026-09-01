import { describe, expect, it } from "vitest";
import {
  addLandmarkToFrontmatter,
  normalizeLandmarkSelection
} from "../../src/commands/MapCommands";

describe("normalizeLandmarkSelection", () => {
  it("collapses whitespace without truncating the selection", () => {
    expect(normalizeLandmarkSelection("  The\nancient\tcity   gate with a very long descriptive suffix  ")).toBe(
      "The ancient city gate with a very long descriptive suffix"
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

  it("creates landmarks when the field is nullish", () => {
    const nullFrontmatter: Record<string, unknown> = {
      landmarks: null
    };
    const undefinedFrontmatter: Record<string, unknown> = {
      landmarks: undefined
    };

    addLandmarkToFrontmatter(nullFrontmatter, "Sky Garden");
    addLandmarkToFrontmatter(undefinedFrontmatter, "Moon Bridge");

    expect(nullFrontmatter.landmarks).toEqual(["Sky Garden"]);
    expect(undefinedFrontmatter.landmarks).toEqual(["Moon Bridge"]);
  });

  it("appends a new landmark without duplicating an existing one", () => {
    const frontmatter: Record<string, unknown> = {
      landmarks: ["Sky Garden"]
    };

    addLandmarkToFrontmatter(frontmatter, "Moon Bridge");
    addLandmarkToFrontmatter(frontmatter, "Sky Garden");

    expect(frontmatter.landmarks).toEqual(["Sky Garden", "Moon Bridge"]);
  });

  it("appends to an empty landmarks array", () => {
    const frontmatter: Record<string, unknown> = {
      landmarks: []
    };

    addLandmarkToFrontmatter(frontmatter, "Sky Garden");

    expect(frontmatter.landmarks).toEqual(["Sky Garden"]);
  });

  it("leaves non-array landmarks unchanged", () => {
    const frontmatter: Record<string, unknown> = {
      landmarks: "Sky Garden"
    };

    addLandmarkToFrontmatter(frontmatter, "Moon Bridge");

    expect(frontmatter.landmarks).toBe("Sky Garden");
  });

  it("leaves mixed landmarks arrays unchanged", () => {
    const landmarks = [123, true, "Sky Garden"];
    const frontmatter: Record<string, unknown> = {
      landmarks
    };

    addLandmarkToFrontmatter(frontmatter, "Moon Bridge");

    expect(frontmatter.landmarks).toBe(landmarks);
    expect(frontmatter.landmarks).toEqual([123, true, "Sky Garden"]);
  });
});
