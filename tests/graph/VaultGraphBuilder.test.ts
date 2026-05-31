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
});
