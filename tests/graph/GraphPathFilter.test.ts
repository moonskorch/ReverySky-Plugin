import { describe, expect, it } from "vitest";
import type { GraphPayload } from "../../src/bridge/BridgeTypes";
import { GraphPathFilter } from "../../src/graph/GraphPathFilter";

function makePayload(): GraphPayload {
  return {
    graphVersion: "0.0.1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    vault: { noteCount: 3 },
    notes: [
      {
        id: "a",
        path: "Notes/Daily/2026-01-01.md",
        title: "A",
        tags: [],
        size: 1
      },
      {
        id: "b",
        path: "Projects/ReverySky/Spec.md",
        title: "B",
        tags: [],
        size: 1
      },
      {
        id: "c",
        path: "Archive/Old.md",
        title: "C",
        tags: [],
        size: 1
      }
    ],
    links: [
      { sourceId: "a", targetId: "b", kind: "resolved" },
      { sourceId: "b", targetId: "c", kind: "resolved" }
    ]
  };
}

describe("GraphPathFilter", () => {
  it("matches notes by path operator", () => {
    const parse = GraphPathFilter.parsePathQuery("path:daily");
    expect(parse.isValid).toBe(true);
    expect(parse.hasPathTerms).toBe(true);
    const filtered = GraphPathFilter.applyPathFilter(makePayload(), parse.parsed);

    expect(filtered.notes.map((n) => n.id)).toEqual(["a"]);
    expect(filtered.links).toHaveLength(0);
    expect(filtered.vault.noteCount).toBe(1);
  });

  it("supports quoted values with spaces", () => {
    const parse = GraphPathFilter.parsePathQuery("path:\"reverysky/spec\"");
    expect(parse.isValid).toBe(true);
    const filtered = GraphPathFilter.applyPathFilter(makePayload(), parse.parsed);

    expect(filtered.notes.map((n) => n.id)).toEqual(["b"]);
  });

  it("supports exclusion with -path", () => {
    const parse = GraphPathFilter.parsePathQuery("-path:archive");
    expect(parse.isValid).toBe(true);
    const filtered = GraphPathFilter.applyPathFilter(makePayload(), parse.parsed);

    expect(filtered.notes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(filtered.links.map((l) => `${l.sourceId}->${l.targetId}`)).toEqual(["a->b"]);
  });

  it("applies multiple include path terms as AND", () => {
    const parse = GraphPathFilter.parsePathQuery("path:projects path:spec");
    expect(parse.isValid).toBe(true);
    const filtered = GraphPathFilter.applyPathFilter(makePayload(), parse.parsed);

    expect(filtered.notes.map((n) => n.id)).toEqual(["b"]);
  });

  it("is case-insensitive and normalizes slashes", () => {
    const payload = makePayload();
    payload.notes[1].path = "Projects\\ReverySky\\Spec.md";

    const parse = GraphPathFilter.parsePathQuery("path:reverysky/spec");
    const filtered = GraphPathFilter.applyPathFilter(payload, parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["b"]);
  });

  it("marks unsupported tokens without failing the query", () => {
    const parse = GraphPathFilter.parsePathQuery("path:daily tag:x file:y");
    expect(parse.isValid).toBe(true);
    expect(parse.hasUnsupportedTokens).toBe(true);
    expect(parse.parsed?.unsupportedTokens).toEqual(["tag:x", "file:y"]);

    const filtered = GraphPathFilter.applyPathFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["a"]);
  });

  it("returns invalid result for unclosed quote", () => {
    const parse = GraphPathFilter.parsePathQuery("path:\"daily");
    expect(parse.isValid).toBe(false);
    expect(parse.parsed).toBeNull();
  });

  it("returns original payload when no path terms are present", () => {
    const payload = makePayload();
    const parse = GraphPathFilter.parsePathQuery("tag:x");
    expect(parse.isValid).toBe(true);
    expect(parse.hasPathTerms).toBe(false);

    const filtered = GraphPathFilter.applyPathFilter(payload, parse.parsed);
    expect(filtered).toBe(payload);
  });
});
