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
        date: "2026-01-01T09:00:00.000Z",
        size: 1
      },
      {
        id: "b",
        path: "Projects/ReverySky/Spec.md",
        title: "B",
        tags: [],
        date: "2026-01-31T23:59:59.000Z",
        size: 1
      },
      {
        id: "c",
        path: "Archive/Old.md",
        title: "C",
        tags: [],
        date: "2025-12-15T00:00:00.000Z",
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

  it("supports regex path filter terms", () => {
    const parse = GraphPathFilter.parsePathQuery("path:/notes\\/daily\\/[0-9]{4}/i");
    expect(parse.isValid).toBe(true);

    const filtered = GraphPathFilter.applyPathFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["a"]);
  });

  it("supports regex exclusion path terms", () => {
    const parse = GraphPathFilter.parsePathQuery("-path:/archive\\//i");
    expect(parse.isValid).toBe(true);

    const filtered = GraphPathFilter.applyPathFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("matches notes by exact date day", () => {
    const parse = GraphPathFilter.parsePathQuery("date:2026-01-01");
    expect(parse.isValid).toBe(true);

    const filtered = GraphPathFilter.applyPathFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["a"]);
  });

  it("uses leading calendar day from datetime strings with timezone offset", () => {
    const payload = makePayload();
    payload.notes[0].date = "2026-01-01T00:30:00+03:00";

    const parse = GraphPathFilter.parsePathQuery("date:2026-01-01");
    expect(parse.isValid).toBe(true);

    const filtered = GraphPathFilter.applyPathFilter(payload, parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["a"]);
  });

  it("supports date ranges with < and >", () => {
    const parse = GraphPathFilter.parsePathQuery("date:>2026-01-01 date:<2026-02-01");
    expect(parse.isValid).toBe(true);

    const filtered = GraphPathFilter.applyPathFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["b"]);
  });

  it("supports negated date filters", () => {
    const parse = GraphPathFilter.parsePathQuery("-date:<2026-01-15");
    expect(parse.isValid).toBe(true);

    const filtered = GraphPathFilter.applyPathFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["b"]);
  });

  it("combines path and date terms as AND", () => {
    const parse = GraphPathFilter.parsePathQuery("path:projects date:2026-01-31");
    expect(parse.isValid).toBe(true);

    const filtered = GraphPathFilter.applyPathFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["b"]);
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

  it("returns invalid result for malformed path regex", () => {
    const parse = GraphPathFilter.parsePathQuery("path:/[broken/");
    expect(parse.isValid).toBe(false);
    expect(parse.parsed).toBeNull();
  });

  it("returns invalid result for malformed date clause", () => {
    const parse = GraphPathFilter.parsePathQuery("date:2026/01/01");
    expect(parse.isValid).toBe(false);
    expect(parse.parsed).toBeNull();
  });

  it("returns invalid result for impossible calendar date", () => {
    const parse = GraphPathFilter.parsePathQuery("date:2026-02-30");
    expect(parse.isValid).toBe(false);
    expect(parse.parsed).toBeNull();
  });

  it("treats empty path term as valid filter with no matches", () => {
    const parse = GraphPathFilter.parsePathQuery("path:");
    expect(parse.isValid).toBe(true);
    expect(parse.hasPathTerms).toBe(true);

    const filtered = GraphPathFilter.applyPathFilter(makePayload(), parse.parsed);
    expect(filtered.notes).toHaveLength(0);
    expect(filtered.links).toHaveLength(0);
    expect(filtered.vault.noteCount).toBe(0);
  });

  it("treats empty quoted path term as valid filter with no matches", () => {
    const parse = GraphPathFilter.parsePathQuery("path:\"\"");
    expect(parse.isValid).toBe(true);
    expect(parse.hasPathTerms).toBe(true);

    const filtered = GraphPathFilter.applyPathFilter(makePayload(), parse.parsed);
    expect(filtered.notes).toHaveLength(0);
    expect(filtered.links).toHaveLength(0);
    expect(filtered.vault.noteCount).toBe(0);
  });

  it("returns original payload when no path terms are present", () => {
    const payload = makePayload();
    const parse = GraphPathFilter.parsePathQuery("tag:x");
    expect(parse.isValid).toBe(true);
    expect(parse.hasPathTerms).toBe(false);

    const filtered = GraphPathFilter.applyPathFilter(payload, parse.parsed);
    expect(filtered).toBe(payload);
  });

  it("does not match include date terms when note has no date", () => {
    const payload = makePayload();
    delete payload.notes[2].date;

    const parse = GraphPathFilter.parsePathQuery("date:<2026-01-01");
    expect(parse.isValid).toBe(true);

    const filtered = GraphPathFilter.applyPathFilter(payload, parse.parsed);
    expect(filtered.notes).toHaveLength(0);
  });
});
