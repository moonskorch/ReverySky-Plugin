import { describe, expect, it, vi } from "vitest";
import ReverySkyMapPlugin from "../src/main";
import { MAP_VIEW_TYPE } from "../src/view/MapView";

type MockLeaf = {
  view?: {
    getState?: () => Record<string, unknown>;
  };
  setViewState: ReturnType<typeof vi.fn>;
};

function createPluginHarness(options?: {
  loadDataResult?: unknown;
  existingLeaves?: MockLeaf[];
  rightLeaf?: MockLeaf | null;
}) {
  const existingLeaves = options?.existingLeaves ?? [];
  const rightLeaf = options?.rightLeaf ?? null;
  const registerView = vi.fn();
  const registerEditorExtension = vi.fn();
  const addRibbonIcon = vi.fn();
  const addCommand = vi.fn();
  const detachLeavesOfType = vi.fn();
  const revealLeaf = vi.fn().mockResolvedValue(undefined);
  const getLeavesOfType = vi.fn((viewType: string) => (viewType === MAP_VIEW_TYPE ? existingLeaves : []));
  const getRightLeaf = vi.fn().mockReturnValue(rightLeaf);
  const loadData = vi.fn().mockResolvedValue(options?.loadDataResult ?? null);
  const saveData = vi.fn().mockResolvedValue(undefined);

  const plugin = new ReverySkyMapPlugin(
    {} as never,
    { id: "reverysky-map" } as never
  );
  Object.assign(plugin, {
    app: {
      workspace: {
        getLeavesOfType,
        getRightLeaf,
        revealLeaf,
        detachLeavesOfType
      },
      vault: {
        configDir: ".obsidian",
        adapter: {
          getBasePath: () => "C:\\Vault"
        }
      }
    },
    manifest: { id: "reverysky-map" },
    registerView,
    registerEditorExtension,
    addRibbonIcon,
    addCommand,
    loadData,
    saveData
  });

  return {
    plugin,
    registerView,
    registerEditorExtension,
    addRibbonIcon,
    addCommand,
    getLeavesOfType,
    getRightLeaf,
    revealLeaf,
    detachLeavesOfType,
    loadData,
    saveData
  };
}

describe("ReverySkyMapPlugin map view state persistence", () => {
  it("captures map state before toggle close and restores it on next open", async () => {
    const closingLeaf: MockLeaf = {
      view: {
        getState: () => ({
          pathFilterQuery: "tag:#project",
          showTags: false,
          mapLayout: "dates"
        })
      },
      setViewState: vi.fn()
    };

    const reopenedLeaf: MockLeaf = {
      setViewState: vi.fn().mockResolvedValue(undefined)
    };

    const existingLeaves = [closingLeaf];
    const harness = createPluginHarness({
      existingLeaves,
      rightLeaf: reopenedLeaf
    });

    await harness.plugin.onload();
    expect(harness.registerEditorExtension).toHaveBeenCalledTimes(1);
    await (harness.addRibbonIcon.mock.calls[0]?.[2] as () => Promise<void>)();

    expect(harness.saveData).toHaveBeenCalledWith({
      mapViewState: {
        pathFilterQuery: "tag:#project",
        showTags: false,
        mapLayout: "dates"
      }
    });
    expect(harness.detachLeavesOfType).toHaveBeenCalledWith(MAP_VIEW_TYPE);

    existingLeaves.length = 0;
    await (harness.addRibbonIcon.mock.calls[0]?.[2] as () => Promise<void>)();

    expect(reopenedLeaf.setViewState).toHaveBeenCalledWith({
      type: MAP_VIEW_TYPE,
      active: true,
      state: {
        pathFilterQuery: "tag:#project",
        showTags: false,
        mapLayout: "dates"
      }
    });
    expect(harness.revealLeaf).toHaveBeenCalledWith(reopenedLeaf);
  });

  it("captures map state during plugin unload without detaching the workspace leaf", async () => {
    const activeLeaf: MockLeaf = {
      view: {
        getState: () => ({
          pathFilterQuery: "path:Projects",
          showTags: true,
          mapLayout: "chronological"
        })
      },
      setViewState: vi.fn()
    };

    const harness = createPluginHarness({
      existingLeaves: [activeLeaf]
    });

    await harness.plugin.onunload();

    expect(harness.saveData).toHaveBeenCalledWith({
      mapViewState: {
        pathFilterQuery: "path:Projects",
        showTags: true,
        mapLayout: "chronological"
      }
    });
    expect(harness.detachLeavesOfType).not.toHaveBeenCalled();
  });

  it("restores persisted map state loaded during plugin startup", async () => {
    const newLeaf: MockLeaf = {
      setViewState: vi.fn().mockResolvedValue(undefined)
    };
    const harness = createPluginHarness({
      loadDataResult: {
        mapViewState: {
          pathFilterQuery: "path:Archive",
          showTags: true,
          mapLayout: "dynamicLinks"
        }
      },
      rightLeaf: newLeaf
    });

    await harness.plugin.onload();
    await (harness.addCommand.mock.calls[0]?.[0]?.callback as () => Promise<void>)();

    expect(harness.loadData).toHaveBeenCalledTimes(1);
    expect(newLeaf.setViewState).toHaveBeenCalledWith({
      type: MAP_VIEW_TYPE,
      active: true,
      state: {
        pathFilterQuery: "path:Archive",
        showTags: true,
        mapLayout: "dynamicLinks"
      }
    });
  });

  it("routes editor focus requests to open map views", async () => {
    const focusA = vi.fn();
    const focusB = vi.fn();
    const mapLeaves = [
      { view: { requestEditorFocus: focusA } },
      { view: { requestEditorFocus: focusB } }
    ];
    const harness = createPluginHarness({
      existingLeaves: mapLeaves as never[]
    });

    await harness.plugin.onload();
    (harness.plugin as unknown as { requestEditorFocus: (path: string) => void }).requestEditorFocus(
      "Folder/Note.md"
    );

    expect(focusA).toHaveBeenCalledWith("Folder/Note.md");
    expect(focusB).toHaveBeenCalledWith("Folder/Note.md");
  });
});
