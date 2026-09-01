import { describe, expect, it } from "vitest";
import { readLandmarkField } from "../../src/graph/FrontmatterLandmarkReader";
import {
  MAX_LANDMARK_COUNT,
  MAX_LANDMARK_NAME_LENGTH
} from "../../src/graph/GraphTextLimits";

describe("readLandmarkField", () => {
  it("reads a scalar string as one landmark without splitting separators", () => {
    expect(readLandmarkField({
      landmarks: " Alice, Bob "
    })).toEqual(["Alice, Bob"]);
  });

  it("reads each string from a YAML list and skips invalid mixed values", () => {
    expect(readLandmarkField({
      landmarks: [" Alice ", 42, "Bob", false, "", null, { name: "Berlin" }]
    })).toEqual([
      "Alice",
      "Bob"
    ]);
  });

  it.each([
    { name: "missing", value: undefined },
    { name: "null", value: null },
    { name: "number", value: 42 },
    { name: "boolean", value: true },
    { name: "object", value: { name: "Berlin" } }
  ])("skips $name values", ({ value }) => {
    expect(readLandmarkField({
      landmarks: value
    })).toEqual([]);
  });

  it("applies runtime name and count limits", () => {
    const longLandmark = "A".repeat(MAX_LANDMARK_NAME_LENGTH + 20);
    const landmarks = [
      longLandmark,
      ...Array.from(
        { length: MAX_LANDMARK_COUNT + 4 },
        (_, index) => `Building ${index + 1}`
      )
    ];

    expect(readLandmarkField({
      landmarks
    })).toEqual([
      longLandmark.slice(0, MAX_LANDMARK_NAME_LENGTH),
      ...landmarks.slice(1, MAX_LANDMARK_COUNT)
    ]);
  });

  it("unwraps whole-string wikilink landmarks", () => {
    expect(readLandmarkField({
      landmarks: [
        "[[Alice]]",
        "[[People/Bob Smith]]",
        "[[People/Carol|Carol C.]]",
        "Met [[Dan]]"
      ]
    })).toEqual([
      "Alice",
      "Bob Smith",
      "Carol C.",
      "Met [[Dan]]"
    ]);
  });

  it("reads the default landmarks field from frontmatter", () => {
    expect(readLandmarkField({
      landmarks: ["Alice", "Bob"]
    })).toEqual(["Alice", "Bob"]);
  });

  it("reads a configured frontmatter field", () => {
    expect(readLandmarkField({
      place: "[[Places/Berlin]]",
      status: true
    }, "place")).toEqual(["Berlin"]);
  });
});
