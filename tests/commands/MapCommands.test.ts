import { describe, expect, it, vi } from "vitest";
import {
  addLandmarkToFrontmatter,
  normalizeLandmarkSelection,
  registerEditorMenuCommands
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

  it("writes to a custom landmark source with the same strict array rules", () => {
    const frontmatter: Record<string, unknown> = {
      landmarks: ["Observatory"],
      people: ["Alice"],
      topics: "Research",
      mixed: ["Sky Garden", 42]
    };

    addLandmarkToFrontmatter(frontmatter, "Bob", "people");
    addLandmarkToFrontmatter(frontmatter, "Berlin", "places");
    addLandmarkToFrontmatter(frontmatter, "Draft", "topics");
    addLandmarkToFrontmatter(frontmatter, "Moon Bridge", "mixed");

    expect(frontmatter.landmarks).toEqual(["Observatory"]);
    expect(frontmatter.people).toEqual(["Alice", "Bob"]);
    expect(frontmatter.places).toEqual(["Berlin"]);
    expect(frontmatter.topics).toBe("Research");
    expect(frontmatter.mixed).toEqual(["Sky Garden", 42]);
  });
});

describe("registerEditorMenuCommands", () => {
  it("adds the selected landmark to the persisted landmark source", async () => {
    const frontmatter: Record<string, unknown> = {
      landmarks: ["Observatory"]
    };
    const { file, getEditorMenuHandler, plugin } = makeEditorMenuPlugin(frontmatter);
    let clickHandler: (() => Promise<void>) | null = null;
    const menuItem = {} as {
      setTitle: ReturnType<typeof vi.fn>;
      setIcon: ReturnType<typeof vi.fn>;
      onClick: ReturnType<typeof vi.fn>;
    };
    menuItem.setTitle = vi.fn(() => menuItem);
    menuItem.setIcon = vi.fn(() => menuItem);
    menuItem.onClick = vi.fn((callback: () => Promise<void>) => {
      clickHandler = callback;
      return menuItem;
    });
    const menu = {
      addItem: vi.fn((callback: (item: typeof menuItem) => void) => callback(menuItem))
    };

    registerEditorMenuCommands(plugin as never);
    getEditorMenuHandler()?.(
      menu,
      { getSelection: () => "  Alice  ", somethingSelected: () => true },
      { file }
    );
    expect(clickHandler).toBeTypeOf("function");
    expect(menuItem.setTitle).toHaveBeenCalledWith("Add to people");
    await clickHandler?.();

    expect(plugin.getLandmarkSource).toHaveBeenCalledTimes(1);
    expect(frontmatter.landmarks).toEqual(["Observatory"]);
    expect(frontmatter.people).toEqual(["Alice"]);
  });

  it("does not show the command when the landmark source cannot be appended", () => {
    const frontmatter: Record<string, unknown> = {
      people: "Alice"
    };
    const { file, getEditorMenuHandler, plugin } = makeEditorMenuPlugin(frontmatter);
    const menu = {
      addItem: vi.fn()
    };

    registerEditorMenuCommands(plugin as never);
    getEditorMenuHandler()?.(
      menu,
      { getSelection: () => "  Bob  ", somethingSelected: () => true },
      { file }
    );

    expect(menu.addItem).not.toHaveBeenCalled();
    expect(plugin.app.metadataCache.getFileCache).toHaveBeenCalledWith(file);
  });

  it("still shows the command when the selected landmark already exists", () => {
    const frontmatter: Record<string, unknown> = {
      people: ["Alice"]
    };
    const { file, getEditorMenuHandler, plugin } = makeEditorMenuPlugin(frontmatter);
    const menu = {
      addItem: vi.fn()
    };

    registerEditorMenuCommands(plugin as never);
    getEditorMenuHandler()?.(
      menu,
      { getSelection: () => "  Alice  ", somethingSelected: () => true },
      { file }
    );

    expect(menu.addItem).toHaveBeenCalledTimes(1);
  });

  it("does not read selection text when the editor has no selection", () => {
    const { file, getEditorMenuHandler, plugin } = makeEditorMenuPlugin({});
    const menu = {
      addItem: vi.fn()
    };
    const editor = {
      getSelection: vi.fn(),
      somethingSelected: vi.fn(() => false)
    };

    registerEditorMenuCommands(plugin as never);
    getEditorMenuHandler()?.(
      menu,
      editor,
      { file }
    );

    expect(editor.getSelection).not.toHaveBeenCalled();
    expect(plugin.getLandmarkSource).not.toHaveBeenCalled();
    expect(plugin.app.metadataCache.getFileCache).not.toHaveBeenCalled();
    expect(menu.addItem).not.toHaveBeenCalled();
  });
});

function makeEditorMenuPlugin(frontmatter: Record<string, unknown>, landmarkSource = "people") {
  const file = { path: "Note.md" };
  let editorMenuHandler:
    | ((menu: unknown, editor: unknown, info: { file?: unknown }) => void)
    | null = null;
  const plugin = {
    registerEvent: vi.fn(),
    getLandmarkSource: vi.fn().mockReturnValue(landmarkSource),
    app: {
      workspace: {
        on: vi.fn((_name: string, callback: typeof editorMenuHandler) => {
          editorMenuHandler = callback;
          return { id: "editor-menu-event" };
        })
      },
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue({
          frontmatter
        })
      },
      fileManager: {
        processFrontMatter: vi.fn(async (_file: unknown, callback: (frontmatter: Record<string, unknown>) => void) => {
          callback(frontmatter);
        })
      }
    }
  };

  return {
    file,
    getEditorMenuHandler: () => editorMenuHandler,
    plugin
  };
}
