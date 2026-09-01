import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { VaultGraphBuilder } from "../../src/graph/VaultGraphBuilder";
import {
  MAX_LANDMARK_COUNT,
  MAX_LANDMARK_NAME_LENGTH,
  MAX_NOTE_TITLE_LENGTH
} from "../../src/graph/GraphTextLimits";

function makeStableId(path: string): string {
  const digest = createHash("sha256").update(path).digest();
  return `note_${digest.subarray(0, 12).toString("base64url")}`;
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
    expect(payload.notes[0]?.id).toBe("note_JfPTXjx4_ogWzWa-");
    expect(payload.notes[0]?.id).toMatch(/^note_[A-Za-z0-9_-]{16}$/);
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
      id: makeStableId("Folder/Note.md"),
      path: "Folder/Note.md",
      tags: ["inline", "second", "third", "fourth"],
      date: "2026-02-03T00:00:00.000Z",
      size: 321
    });
  });

  it("limits note titles for the runtime payload", () => {
    const longTitle = "A".repeat(MAX_NOTE_TITLE_LENGTH + 20);
    const file = makeFile(`Folder/${longTitle}.md`, {
      ctime: Date.UTC(2026, 0, 1),
      mtime: Date.UTC(2026, 0, 2),
      size: 64
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
    expect(payload.notes[0]?.title).toBe(longTitle.slice(0, MAX_NOTE_TITLE_LENGTH));
  });

  it("maps frontmatter landmark arrays to optional building names", () => {
    const longLandmark = "A".repeat(MAX_LANDMARK_NAME_LENGTH + 20);
    const file = makeFile("Folder/Landmarks.md", {
      ctime: Date.UTC(2026, 0, 1),
      mtime: Date.UTC(2026, 0, 2),
      size: 64
    });

    const app = {
      vault: {
        getMarkdownFiles: () => [file]
      },
      metadataCache: {
        getFileCache: () => ({
          frontmatter: {
            landmarks: [" Observatory ", 42, "", longLandmark, null]
          }
        }),
        resolvedLinks: {}
      }
    };

    const payload = VaultGraphBuilder.build(app as never);
    expect(payload.notes[0]?.buildings).toEqual([
      "Observatory",
      longLandmark.slice(0, MAX_LANDMARK_NAME_LENGTH)
    ]);
  });

  it("maps scalar frontmatter landmarks as one building name", () => {
    const file = makeFile("Folder/ScalarLandmark.md", {
      ctime: Date.UTC(2026, 0, 1),
      mtime: Date.UTC(2026, 0, 2),
      size: 64
    });

    const app = {
      vault: {
        getMarkdownFiles: () => [file]
      },
      metadataCache: {
        getFileCache: () => ({
          frontmatter: {
            landmarks: "[[Places/Berlin|Berlin]]"
          }
        }),
        resolvedLinks: {}
      }
    };

    const payload = VaultGraphBuilder.build(app as never);
    expect(payload.notes[0]?.buildings).toEqual(["Berlin"]);
  });

  it("keeps only the first runtime building names", () => {
    const file = makeFile("Folder/ManyBuildings.md", {
      ctime: Date.UTC(2026, 0, 1),
      mtime: Date.UTC(2026, 0, 2),
      size: 64
    });
    const landmarks = Array.from(
      { length: MAX_LANDMARK_COUNT + 4 },
      (_, index) => `Building ${index + 1}`
    );

    const app = {
      vault: {
        getMarkdownFiles: () => [file]
      },
      metadataCache: {
        getFileCache: () => ({
          frontmatter: {
            landmarks
          }
        }),
        resolvedLinks: {}
      }
    };

    const payload = VaultGraphBuilder.build(app as never);
    expect(payload.notes[0]?.buildings).toEqual(
      landmarks.slice(0, MAX_LANDMARK_COUNT)
    );
  });

  it.each([
    {
      name: "missing landmarks",
      frontmatter: {}
    },
    {
      name: "invalid scalar landmarks",
      frontmatter: {
        landmarks: 42
      }
    },
    {
      name: "empty landmarks array",
      frontmatter: {
        landmarks: []
      }
    },
    {
      name: "landmarks without strings",
      frontmatter: {
        landmarks: [1, null, false]
      }
    }
  ])("omits buildings for $name", ({ frontmatter }) => {
    const file = makeFile("Folder/NoBuildings.md", {
      ctime: Date.UTC(2026, 0, 1),
      mtime: Date.UTC(2026, 0, 2),
      size: 64
    });

    const app = {
      vault: {
        getMarkdownFiles: () => [file]
      },
      metadataCache: {
        getFileCache: () => ({
          frontmatter
        }),
        resolvedLinks: {}
      }
    };

    const payload = VaultGraphBuilder.build(app as never);
    expect(payload.notes[0]).not.toHaveProperty("buildings");
  });

  it("filters files with empty normalized paths instead of emitting invalid notes", () => {
    const validFile = makeFile("Folder/Valid.md", {
      ctime: Date.UTC(2026, 0, 1),
      mtime: Date.UTC(2026, 0, 2),
      size: 123
    });
    const emptyPathFile = makeFile("   ", {
      ctime: Date.UTC(2026, 0, 1),
      mtime: Date.UTC(2026, 0, 2),
      size: 456
    });

    const app = {
      vault: {
        getMarkdownFiles: () => [emptyPathFile, validFile]
      },
      metadataCache: {
        getFileCache: () => ({
          frontmatter: {}
        }),
        resolvedLinks: {
          "": {
            "Folder/Valid.md": 1
          },
          "Folder/Valid.md": {
            "   ": 1
          }
        }
      }
    };

    const payload = VaultGraphBuilder.build(app as never);
    expect(payload.vault.noteCount).toBe(1);
    expect(payload.notes).toHaveLength(1);
    expect(payload.notes[0]).toMatchObject({
      id: makeStableId("Folder/Valid.md"),
      path: "Folder/Valid.md"
    });
    expect(payload.links).toEqual([]);
  });

  it("preserves significant whitespace in real file paths", () => {
    const file = makeFile(" Folder/Note.md", {
      ctime: Date.UTC(2026, 0, 1),
      mtime: Date.UTC(2026, 0, 2),
      size: 123
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
    expect(payload.notes).toHaveLength(1);
    expect(payload.notes[0]).toMatchObject({
      id: makeStableId(" Folder/Note.md"),
      path: " Folder/Note.md"
    });
  });

  it.each([
    {
      name: "prefers date over created aliases",
      frontmatter: {
        date: "2026-02-03",
        created: "2026-02-02",
        created_at: "2026-02-01"
      },
      expected: "2026-02-03T00:00:00.000Z"
    },
    {
      name: "falls back to created when date is missing or invalid",
      frontmatter: {
        date: "invalid",
        created: "2026-03-04"
      },
      expected: "2026-03-04T00:00:00.000Z"
    },
    {
      name: "falls back to created_at when earlier aliases are missing or invalid",
      frontmatter: {
        date: "   ",
        created: "invalid",
        created_at: "2026-04-05"
      },
      expected: "2026-04-05T00:00:00.000Z"
    }
  ])("$name", ({ frontmatter, expected }) => {
    const ctime = Date.UTC(2026, 4, 20, 12, 30, 0);
    const file = makeFile("Fallback/Priority.md", {
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
          frontmatter
        }),
        resolvedLinks: {}
      }
    };

    const payload = VaultGraphBuilder.build(app as never);
    expect(payload.notes[0]?.date).toBe(expected);
  });

  it("falls back to file.stat.ctime when all supported frontmatter aliases are missing or invalid", () => {
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
            date: "   ",
            created: "invalid",
            created_at: null
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

  it("falls back to created date when frontmatter date string is invalid", () => {
    const ctime = Date.UTC(2026, 6, 10, 8, 0, 0);
    const file = makeFile("Fallback/InvalidFrontmatterDate.md", {
      ctime,
      mtime: ctime,
      size: 100
    });

    const app = {
      vault: {
        getMarkdownFiles: () => [file]
      },
      metadataCache: {
        getFileCache: () => ({
          frontmatter: {
            date: "32/13/2026"
          }
        }),
        resolvedLinks: {}
      }
    };

    const payload = VaultGraphBuilder.build(app as never);
    expect(payload.notes[0]?.date).toBe(new Date(ctime).toISOString());
  });
});
