import { describe, expect, it } from "vitest";
import type { GraphPayload } from "../../src/bridge/BridgeTypes";
import { GraphQueryFilter } from "../../src/graph/GraphQueryFilter";

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
        tags: ["work", "daily"],
        date: "2026-01-01T09:00:00.000Z",
        size: 1
      },
      {
        id: "b",
        path: "Projects/ReverySky/Spec.md",
        title: "B",
        tags: ["work/subtag", "project"],
        date: "2026-01-31T23:59:59.000Z",
        size: 1
      },
      {
        id: "c",
        path: "Archive/Old.md",
        title: "C",
        tags: ["archive"],
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

describe("GraphQueryFilter", () => {
  it("matches notes by path operator", () => {
    const parse = GraphQueryFilter.parseQuery("path:daily");
    expect(parse.isValid).toBe(true);
    expect(parse.hasSupportedTerms).toBe(true);
    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);

    expect(filtered.notes.map((n) => n.id)).toEqual(["a"]);
    expect(filtered.links).toHaveLength(0);
    expect(filtered.vault.noteCount).toBe(1);
  });

  it("supports quoted values with spaces", () => {
    const parse = GraphQueryFilter.parseQuery("path:\"reverysky/spec\"");
    expect(parse.isValid).toBe(true);
    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);

    expect(filtered.notes.map((n) => n.id)).toEqual(["b"]);
  });

  it("supports exclusion with -path", () => {
    const parse = GraphQueryFilter.parseQuery("-path:archive");
    expect(parse.isValid).toBe(true);
    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);

    expect(filtered.notes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(filtered.links.map((l) => `${l.sourceId}->${l.targetId}`)).toEqual(["a->b"]);
  });

  it("supports regex path filter terms", () => {
    const parse = GraphQueryFilter.parseQuery("path:/notes\\/daily\\/[0-9]{4}/i");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["a"]);
  });

  it("supports regex exclusion path terms", () => {
    const parse = GraphQueryFilter.parseQuery("-path:/archive\\//i");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("matches notes by exact date day", () => {
    const parse = GraphQueryFilter.parseQuery("date:2026-01-01");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["a"]);
  });

  it("uses leading calendar day from datetime strings with timezone offset", () => {
    const payload = makePayload();
    payload.notes[0].date = "2026-01-01T00:30:00+03:00";

    const parse = GraphQueryFilter.parseQuery("date:2026-01-01");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(payload, parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["a"]);
  });

  it("supports date ranges with < and >", () => {
    const parse = GraphQueryFilter.parseQuery("date:>2026-01-01 date:<2026-02-01");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["b"]);
  });

  it("supports inclusive date ranges with >= and <=", () => {
    const parse = GraphQueryFilter.parseQuery("date:>=2026-01-01 date:<=2026-01-31");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("supports negated date filters", () => {
    const parse = GraphQueryFilter.parseQuery("-date:<2026-01-15");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["b"]);
  });

  it("combines path and date terms as AND", () => {
    const parse = GraphQueryFilter.parseQuery("path:projects date:2026-01-31");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["b"]);
  });

  it("matches notes by tag operator with hash prefix", () => {
    const parse = GraphQueryFilter.parseQuery("tag:#work");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("matches nested tag branches in an Obsidian-friendly way", () => {
    const parse = GraphQueryFilter.parseQuery("tag:work");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("supports negated tag filters", () => {
    const parse = GraphQueryFilter.parseQuery("-tag:#archive");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("applies multiple include tag terms as AND", () => {
    const parse = GraphQueryFilter.parseQuery("tag:work tag:project");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["b"]);
  });

  it("combines include and exclude tag terms", () => {
    const parse = GraphQueryFilter.parseQuery("tag:work -tag:daily");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["b"]);
  });

  it("combines path, date, and tag terms as AND", () => {
    const parse = GraphQueryFilter.parseQuery("path:projects date:2026-01-31 tag:#work");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["b"]);
  });

  it("applies multiple include path terms as AND", () => {
    const parse = GraphQueryFilter.parseQuery("path:projects path:spec");
    expect(parse.isValid).toBe(true);
    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);

    expect(filtered.notes.map((n) => n.id)).toEqual(["b"]);
  });

  it("is case-insensitive and normalizes slashes", () => {
    const payload = makePayload();
    payload.notes[1].path = "Projects\\ReverySky\\Spec.md";

    const parse = GraphQueryFilter.parseQuery("path:reverysky/spec");
    const filtered = GraphQueryFilter.applyFilter(payload, parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["b"]);
  });

  it("matches tags case-insensitively", () => {
    const parse = GraphQueryFilter.parseQuery("tag:#WORK");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("marks unsupported tokens without failing the query", () => {
    const parse = GraphQueryFilter.parseQuery("path:daily tag:work file:y");
    expect(parse.isValid).toBe(true);
    expect(parse.hasUnsupportedTokens).toBe(true);
    expect(parse.parsed?.unsupportedTokens).toEqual(["file:y"]);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes.map((n) => n.id)).toEqual(["a"]);
  });

  it("returns invalid result for unclosed quote", () => {
    const parse = GraphQueryFilter.parseQuery("path:\"daily");
    expect(parse.isValid).toBe(false);
    expect(parse.parsed).toBeNull();
  });

  it("returns invalid result for malformed path regex", () => {
    const parse = GraphQueryFilter.parseQuery("path:/[broken/");
    expect(parse.isValid).toBe(false);
    expect(parse.parsed).toBeNull();
  });

  it("returns invalid result for malformed date clause", () => {
    const parse = GraphQueryFilter.parseQuery("date:2026/01/01");
    expect(parse.isValid).toBe(false);
    expect(parse.parsed).toBeNull();
  });

  it("returns invalid result for impossible calendar date", () => {
    const parse = GraphQueryFilter.parseQuery("date:2026-02-30");
    expect(parse.isValid).toBe(false);
    expect(parse.parsed).toBeNull();
  });

  it("treats empty path term as valid filter with no matches", () => {
    const parse = GraphQueryFilter.parseQuery("path:");
    expect(parse.isValid).toBe(true);
    expect(parse.hasSupportedTerms).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes).toHaveLength(0);
    expect(filtered.links).toHaveLength(0);
    expect(filtered.vault.noteCount).toBe(0);
  });

  it("treats empty quoted path term as valid filter with no matches", () => {
    const parse = GraphQueryFilter.parseQuery("path:\"\"");
    expect(parse.isValid).toBe(true);
    expect(parse.hasSupportedTerms).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes).toHaveLength(0);
    expect(filtered.links).toHaveLength(0);
    expect(filtered.vault.noteCount).toBe(0);
  });

  it("treats empty tag term as valid filter with no matches", () => {
    const parse = GraphQueryFilter.parseQuery("tag:");
    expect(parse.isValid).toBe(true);
    expect(parse.hasSupportedTerms).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(makePayload(), parse.parsed);
    expect(filtered.notes).toHaveLength(0);
    expect(filtered.links).toHaveLength(0);
    expect(filtered.vault.noteCount).toBe(0);
  });

  it("returns original payload when no supported terms are present", () => {
    const payload = makePayload();
    const parse = GraphQueryFilter.parseQuery("file:y");
    expect(parse.isValid).toBe(true);
    expect(parse.hasSupportedTerms).toBe(false);

    const filtered = GraphQueryFilter.applyFilter(payload, parse.parsed);
    expect(filtered).toBe(payload);
  });

  it("does not match include date terms when note has no date", () => {
    const payload = makePayload();
    delete payload.notes[2].date;

    const parse = GraphQueryFilter.parseQuery("date:<2026-01-01");
    expect(parse.isValid).toBe(true);

    const filtered = GraphQueryFilter.applyFilter(payload, parse.parsed);
    expect(filtered.notes).toHaveLength(0);
  });
});
