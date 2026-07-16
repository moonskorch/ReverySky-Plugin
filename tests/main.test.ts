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
  const registerEvent = vi.fn();
  const detachLeavesOfType = vi.fn();
  const revealLeaf = vi.fn().mockResolvedValue(undefined);
  const getLeavesOfType = vi.fn((viewType: string) => (viewType === MAP_VIEW_TYPE ? existingLeaves : []));
  const getRightLeaf = vi.fn().mockReturnValue(rightLeaf);
  const workspaceOn = vi.fn().mockReturnValue({ id: "workspace-event-ref" });
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
        detachLeavesOfType,
        on: workspaceOn
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
    registerEvent,
    loadData,
    saveData
  });

  return {
    plugin,
    registerView,
    registerEditorExtension,
    addRibbonIcon,
    addCommand,
    registerEvent,
    workspaceOn,
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
    const runtimeServer = {
      stop: vi.fn().mockResolvedValue(undefined)
    };
    const closingLeaf: MockLeaf = {
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
    (harness.plugin as unknown as { unityWebglServer: typeof runtimeServer | null }).unityWebglServer = runtimeServer;
    (harness.plugin as unknown as { updateMapViewState: (state: Record<string, unknown>) => void }).updateMapViewState({
      pathFilterQuery: "tag:#project",
      showTags: false,
      mapLayout: "dates"
    });
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
    expect(runtimeServer.stop).not.toHaveBeenCalled();

    const createMapView = harness.registerView.mock.calls[0]?.[1] as
      | ((leaf: { app?: unknown }) => { onClose: () => Promise<void> })
      | undefined;
    expect(createMapView).toBeDefined();
    const closedView = createMapView?.({ app: harness.plugin.app });
    await closedView?.onClose();

    expect(runtimeServer.stop).toHaveBeenCalledTimes(1);
    expect((harness.plugin as unknown as { unityWebglServer: unknown }).unityWebglServer).toBeNull();

    existingLeaves.length = 0;
    await (harness.addRibbonIcon.mock.calls[0]?.[2] as () => Promise<void>)();

    expect(reopenedLeaf.setViewState).toHaveBeenCalledWith({
      type: MAP_VIEW_TYPE,
      active: true
    });
    expect(harness.revealLeaf).toHaveBeenCalledWith(reopenedLeaf);
  });

  it("captures map state during plugin unload before detaching the workspace leaf", async () => {
    const runtimeServer = {
      stop: vi.fn().mockResolvedValue(undefined)
    };
    const activeLeaf: MockLeaf = {
      setViewState: vi.fn()
    };

    const harness = createPluginHarness({
      existingLeaves: [activeLeaf]
    });

    (harness.plugin as unknown as { unityWebglServer: typeof runtimeServer | null }).unityWebglServer = runtimeServer;
    (harness.plugin as unknown as { updateMapViewState: (state: Record<string, unknown>) => void }).updateMapViewState({
      pathFilterQuery: "path:Projects",
      showTags: true,
      mapLayout: "chronological"
    });
    await (harness.plugin as unknown as { cleanupOnUnload: () => Promise<void> }).cleanupOnUnload();

    expect(harness.saveData).toHaveBeenCalledWith({
      mapViewState: {
        pathFilterQuery: "path:Projects",
        showTags: true,
        mapLayout: "chronological"
      }
    });
    expect(harness.detachLeavesOfType).toHaveBeenCalledWith(MAP_VIEW_TYPE);
    expect(harness.saveData.mock.invocationCallOrder[0]).toBeLessThan(harness.detachLeavesOfType.mock.invocationCallOrder[0]);
    expect(runtimeServer.stop).toHaveBeenCalledTimes(1);
    expect(harness.detachLeavesOfType.mock.invocationCallOrder[0]).toBeLessThan(runtimeServer.stop.mock.invocationCallOrder[0]);
    expect((harness.plugin as unknown as { unityWebglServer: unknown }).unityWebglServer).toBeNull();
  });

  it("adds map state persistence to Obsidian quit tasks", async () => {
    const activeLeaf: MockLeaf = {
      setViewState: vi.fn()
    };
    const harness = createPluginHarness({
      existingLeaves: [activeLeaf]
    });
    const tasks = {
      addPromise: vi.fn()
    };

    await harness.plugin.onload();
    (harness.plugin as unknown as { updateMapViewState: (state: Record<string, unknown>) => void }).updateMapViewState({
      pathFilterQuery: "tag:#daily",
      showTags: false,
      mapLayout: "dates"
    });

    const quitHandler = harness.workspaceOn.mock.calls.find((call) => call[0] === "quit")?.[1] as
      | ((receivedTasks: typeof tasks) => void)
      | undefined;
    expect(quitHandler).toBeDefined();

    quitHandler?.(tasks);
    expect(tasks.addPromise).toHaveBeenCalledTimes(1);
    await tasks.addPromise.mock.calls[0]?.[0];

    expect(harness.saveData).toHaveBeenCalledWith({
      mapViewState: {
        pathFilterQuery: "tag:#daily",
        showTags: false,
        mapLayout: "dates"
      }
    });
    expect(harness.detachLeavesOfType).not.toHaveBeenCalled();
  });

  it("stops the runtime server during unload when state persistence fails", async () => {
    const runtimeServer = {
      stop: vi.fn().mockResolvedValue(undefined)
    };
    const activeLeaf: MockLeaf = {
      setViewState: vi.fn()
    };
    const harness = createPluginHarness({
      existingLeaves: [activeLeaf]
    });
    const saveError = new Error("save failed");

    harness.saveData.mockRejectedValueOnce(saveError);
    (harness.plugin as unknown as { unityWebglServer: typeof runtimeServer | null }).unityWebglServer = runtimeServer;
    (
      harness.plugin as unknown as {
        updateMapViewState: (state: Record<string, unknown>, persist?: boolean) => void;
      }
    ).updateMapViewState({
      pathFilterQuery: "path:Projects"
    }, false);

    await expect(
      (harness.plugin as unknown as { cleanupOnUnload: () => Promise<void> }).cleanupOnUnload()
    ).rejects.toThrow(saveError);

    expect(harness.detachLeavesOfType).toHaveBeenCalledWith(MAP_VIEW_TYPE);
    expect(runtimeServer.stop).toHaveBeenCalledTimes(1);
    expect(harness.detachLeavesOfType.mock.invocationCallOrder[0]).toBeLessThan(runtimeServer.stop.mock.invocationCallOrder[0]);
    expect((harness.plugin as unknown as { unityWebglServer: unknown }).unityWebglServer).toBeNull();
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
      active: true
    });
  });

  it("reveals the existing map leaf instead of creating another one", async () => {
    const existingLeaf: MockLeaf = {
      setViewState: vi.fn()
    };
    const unusedRightLeaf: MockLeaf = {
      setViewState: vi.fn().mockResolvedValue(undefined)
    };
    const harness = createPluginHarness({
      existingLeaves: [existingLeaf],
      rightLeaf: unusedRightLeaf
    });

    await harness.plugin.onload();
    await (harness.addCommand.mock.calls[0]?.[0]?.callback as () => Promise<void>)();

    expect(harness.getRightLeaf).not.toHaveBeenCalled();
    expect(existingLeaf.setViewState).not.toHaveBeenCalled();
    expect(unusedRightLeaf.setViewState).not.toHaveBeenCalled();
    expect(harness.revealLeaf).toHaveBeenCalledWith(existingLeaf);
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
