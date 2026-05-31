import { describe, expect, it } from "vitest";
import { VaultGraphBuilder } from "../../src/graph/VaultGraphBuilder";

function makeStableId(path: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `note_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function makeFile(path: string, stat: { ctime: number; mtime: number; size?: number }) {
  return {
    path,
    basename: path.split("/").pop()?.replace(/\.md$/i, "") ?? "Note",
    stat
  };
}

describe("VaultGraphBuilder", () => {
  it("always derives note id from file path and ignores frontmatter id", () => {
    const file = {
      path: "Folder/Note.md",
      basename: "Note",
      stat: {
        ctime: Date.UTC(2026, 0, 1),
        mtime: Date.UTC(2026, 0, 2)
      }
    };

    const app = {
      vault: {
        getMarkdownFiles: () => [file]
      },
      metadataCache: {
        getFileCache: () => ({
          frontmatter: {
            id: "custom-frontmatter-id",
            date: "2026-01-03"
          }
        }),
        resolvedLinks: {}
      }
    };

    const payload = VaultGraphBuilder.build(app as never);
    expect(payload.notes).toHaveLength(1);
    expect(payload.notes[0]?.id).toBe(makeStableId("Folder/Note.md"));
    expect(payload.notes[0]?.id).not.toBe("custom-frontmatter-id");
  });

  it("maps tags/date/size field-by-field with normalization and truncation", () => {
    const file = makeFile("Folder\\Note.md", {
      ctime: Date.UTC(2026, 0, 1),
      mtime: Date.UTC(2026, 0, 2),
      size: 321.9
    });

    const app = {
      vault: {
        getMarkdownFiles: () => [file]
      },
      metadataCache: {
        getFileCache: () => ({
          tags: [{ tag: "#inline" }, { tag: " second " }],
          frontmatter: {
            tags: "second, #third, fourth",
            date: "2026-02-03"
          }
        }),
        resolvedLinks: {}
      }
    };

    const payload = VaultGraphBuilder.build(app as never);
    expect(payload.notes).toHaveLength(1);
    expect(payload.notes[0]).toMatchObject({
      path: "Folder/Note.md",
      tags: ["inline", "second", "third", "fourth"],
      date: "2026-02-03T00:00:00.000Z",
      size: 321
    });
  });

  it("falls back to created date when frontmatter date is blank", () => {
    const ctime = Date.UTC(2026, 4, 20, 12, 30, 0);
    const file = makeFile("Fallback/Created.md", {
      ctime,
      mtime: ctime,
      size: 10
    });

    const app = {
      vault: {
        getMarkdownFiles: () => [file]
      },
      metadataCache: {
        getFileCache: () => ({
          frontmatter: {
            date: "   "
          }
        }),
        resolvedLinks: {}
      }
    };

    const payload = VaultGraphBuilder.build(app as never);
    expect(payload.notes[0]?.date).toBe(new Date(ctime).toISOString());
  });

  it("uses safe fallbacks when size and date sources are not usable", () => {
    const file = makeFile("Fallback/Invalid.md", {
      ctime: Number.NaN,
      mtime: Date.UTC(2026, 0, 1),
      size: -42
    });

    const app = {
      vault: {
        getMarkdownFiles: () => [file]
      },
      metadataCache: {
        getFileCache: () => ({
          frontmatter: {}
        }),
        resolvedLinks: {}
      }
    };

    const payload = VaultGraphBuilder.build(app as never);
    expect(payload.notes[0]?.size).toBe(0);
    expect(payload.notes[0]).not.toHaveProperty("date");
  });
});
