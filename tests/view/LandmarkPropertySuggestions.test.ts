import { describe, expect, it, vi } from "vitest";
import { getLandmarkPropertySuggestions } from "../../src/view/LandmarkPropertySuggestions";

describe("getLandmarkPropertySuggestions", () => {
  it("returns an empty list when active file metadata is unavailable", () => {
    expect(getLandmarkPropertySuggestions({} as never)).toEqual([]);
  });

  it("returns an empty list when active file lookup throws", () => {
    const app = {
      workspace: {
        getActiveFile: vi.fn(() => {
          throw new Error("workspace unavailable");
        })
      }
    };

    expect(getLandmarkPropertySuggestions(app as never)).toEqual([]);
  });

  it("suggests active note frontmatter properties with readable landmark values", () => {
    const activeFile = { path: "Daily.md" };
    const app = {
      workspace: {
        getActiveFile: vi.fn().mockReturnValue(activeFile)
      },
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue({
          frontmatter: {
            aliases: ["Daily"],
            count: 42,
            landmarks: ["Observatory"],
            mixed: ["Alice", 42, false],
            mood: "focused",
            nested: { name: "Berlin" },
            tags: ["daily", "map"]
          }
        })
      }
    };

    expect(getLandmarkPropertySuggestions(app as never)).toEqual(["aliases", "landmarks", "mixed", "mood"]);
    expect(app.metadataCache.getFileCache).toHaveBeenCalledWith(activeFile);
  });

  it("keeps empty arrays and empty frontmatter fields as valid landmark source candidates", () => {
    const app = makeActiveFileApp({
      empty: [],
      flag: true,
      people: null,
      object: {},
      project: undefined,
      title: ""
    });

    expect(getLandmarkPropertySuggestions(app as never)).toEqual(["empty", "people", "project", "title"]);
  });
});

function makeActiveFileApp(frontmatter: unknown): unknown {
  const activeFile = { path: "Active.md" };
  return {
    workspace: {
      getActiveFile: vi.fn().mockReturnValue(activeFile)
    },
    metadataCache: {
      getFileCache: vi.fn().mockReturnValue({ frontmatter })
    }
  };
}
