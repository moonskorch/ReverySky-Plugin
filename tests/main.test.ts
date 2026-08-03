import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeServerMock = vi.hoisted(() => {
  type RuntimeServerInstance = {
    baseUrl: string;
    getBaseUrl: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  const pendingBaseUrlResolvers: Array<() => void> = [];

  return {
    delayBaseUrl: false,
    instances: [] as RuntimeServerInstance[],
    reset() {
      this.delayBaseUrl = false;
      this.instances.length = 0;
      pendingBaseUrlResolvers.length = 0;
    },
    resolvePendingBaseUrls() {
      while (pendingBaseUrlResolvers.length > 0) {
        pendingBaseUrlResolvers.shift()?.();
      }
    },
    createInstance() {
      const instance: RuntimeServerInstance = {
        baseUrl: `http://127.0.0.1:${7000 + this.instances.length}`,
        getBaseUrl: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined)
      };
      instance.getBaseUrl.mockImplementation(() => {
        if (!this.delayBaseUrl) {
          return Promise.resolve(instance.baseUrl);
        }

        return new Promise<string>((resolve) => {
          pendingBaseUrlResolvers.push(() => resolve(instance.baseUrl));
        });
      });
      this.instances.push(instance);
      return instance;
    }
  };
});

vi.mock("../src/runtime/UnityWebglLocalServer", () => ({
  UnityWebglLocalServer: vi.fn().mockImplementation(function MockUnityWebglLocalServer() {
    return runtimeServerMock.createInstance();
  })
}));

vi.mock("../src/runtime/EmbeddedUnityRuntimeArchive", () => ({
  getEmbeddedUnityRuntimeArchiveBase64: () => null,
  getEmbeddedUnityRuntimeArchiveSha256: () => null,
  hasEmbeddedUnityRuntimeArchive: () => false
}));

vi.mock("../src/runtime/EmbeddedUnityIndexHtml", () => ({
  getEmbeddedUnityIndexHtml: () => null
}));

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
  const getActiveViewOfType = vi.fn().mockReturnValue(null);
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
        getActiveViewOfType,
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
    getActiveViewOfType,
    getRightLeaf,
    revealLeaf,
    detachLeavesOfType,
    loadData,
    saveData
  };
}

describe("ReverySkyMapPlugin map view state persistence", () => {
  beforeEach(() => {
    runtimeServerMock.reset();
  });

  it("captures map state before toggle close and restores it on next open", async () => {
    const runtimeServer = {
      getBaseUrl: vi.fn().mockResolvedValue("http://127.0.0.1:7000"),
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
      filterQuery: "tag:#project",
      showTags: false,
      mapLayout: "dates",
      frameRateMode: "fps60"
    });
    expect(harness.registerEditorExtension).toHaveBeenCalledTimes(1);
    await (harness.addRibbonIcon.mock.calls[0]?.[2] as () => Promise<void>)();

    expect(harness.saveData).toHaveBeenCalledWith({
      mapViewState: {
        filterQuery: "tag:#project",
        showTags: false,
        mapLayout: "dates",
        frameRateMode: "fps60"
      }
    });
    expect(harness.detachLeavesOfType).toHaveBeenCalledWith(MAP_VIEW_TYPE);
    expect(runtimeServer.stop).not.toHaveBeenCalled();

    const createMapView = harness.registerView.mock.calls[0]?.[1] as
      | ((leaf: { app?: unknown }) => { onOpen: () => Promise<void>; onClose: () => Promise<void> })
      | undefined;
    expect(createMapView).toBeDefined();
    const closedView = createMapView?.({ app: harness.plugin.app }) as
      | ({ contentEl: HTMLElement & { onWindowMigrated?: (listener: (win: Window) => void) => () => void } } & {
          onOpen: () => Promise<void>;
          onClose: () => Promise<void>;
        })
      | undefined;
    expect(closedView).toBeDefined();
    closedView!.contentEl.onWindowMigrated = vi.fn(() => () => undefined);
    await closedView!.onOpen();
    await closedView!.onClose();

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
      filterQuery: "path:Projects",
      showTags: true,
      mapLayout: "chronological",
      frameRateMode: "fps24"
    });
    await (harness.plugin as unknown as { cleanupOnUnload: () => Promise<void> }).cleanupOnUnload();

    expect(harness.saveData).toHaveBeenCalledWith({
      mapViewState: {
        filterQuery: "path:Projects",
        showTags: true,
        mapLayout: "chronological",
        frameRateMode: "fps24"
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
      filterQuery: "tag:#daily",
      showTags: false,
      mapLayout: "dates",
      frameRateMode: "fps60"
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
        filterQuery: "tag:#daily",
        showTags: false,
        mapLayout: "dates",
        frameRateMode: "fps60"
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
      filterQuery: "path:Projects"
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
          filterQuery: "path:Archive",
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

  it("registers a copy screenshot command that copies from the active map view", async () => {
    const copyRuntimeScreenshotToClipboard = vi.fn().mockResolvedValue(undefined);
    const activeView = {
      copyRuntimeScreenshotToClipboard
    };
    const harness = createPluginHarness();
    harness.getActiveViewOfType.mockReturnValue(activeView as never);

    await harness.plugin.onload();

    expect(harness.addCommand).toHaveBeenCalledTimes(2);
    expect(harness.addCommand.mock.calls[1]?.[0]).toMatchObject({
      id: "copy-screenshot",
      name: "Copy screenshot"
    });

    await (harness.addCommand.mock.calls[1]?.[0]?.callback as () => Promise<void>)();

    expect(copyRuntimeScreenshotToClipboard).toHaveBeenCalledTimes(1);
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

  it("shares one runtime server during concurrent cold starts", async () => {
    const harness = createPluginHarness();
    runtimeServerMock.delayBaseUrl = true;

    const firstRuntimeUrl = harness.plugin.getUnityRuntimeUrl();
    const secondRuntimeUrl = harness.plugin.getUnityRuntimeUrl();

    expect(runtimeServerMock.instances).toHaveLength(1);
    expect(runtimeServerMock.instances[0]?.getBaseUrl).toHaveBeenCalledTimes(1);

    runtimeServerMock.resolvePendingBaseUrls();

    await expect(Promise.all([firstRuntimeUrl, secondRuntimeUrl])).resolves.toEqual([
      "http://127.0.0.1:7000/index.html",
      "http://127.0.0.1:7000/index.html"
    ]);
  });

  it("keeps the runtime server alive until the last map view lease is released", async () => {
    const harness = createPluginHarness();
    await harness.plugin.getUnityRuntimeUrl();
    const runtimeServer = runtimeServerMock.instances[0];
    const firstLease = harness.plugin.acquireMapViewRuntimeLease();
    const secondLease = harness.plugin.acquireMapViewRuntimeLease();

    await harness.plugin.releaseMapViewRuntimeLease(firstLease);

    expect(runtimeServer?.stop).not.toHaveBeenCalled();

    await harness.plugin.releaseMapViewRuntimeLease(secondLease);

    expect(runtimeServer?.stop).toHaveBeenCalledTimes(1);
    expect((harness.plugin as unknown as { unityWebglServer: unknown }).unityWebglServer).toBeNull();
  });

  it("stops a runtime server after in-flight startup when the last lease closes", async () => {
    const harness = createPluginHarness();
    runtimeServerMock.delayBaseUrl = true;
    const lease = harness.plugin.acquireMapViewRuntimeLease();

    const runtimeUrlPromise = harness.plugin.getUnityRuntimeUrl();
    const releasePromise = harness.plugin.releaseMapViewRuntimeLease(lease);

    expect(runtimeServerMock.instances).toHaveLength(1);
    expect(runtimeServerMock.instances[0]?.stop).not.toHaveBeenCalled();

    runtimeServerMock.resolvePendingBaseUrls();
    await runtimeUrlPromise;
    await releasePromise;

    expect(runtimeServerMock.instances[0]?.stop).toHaveBeenCalledTimes(1);
    expect((harness.plugin as unknown as { unityWebglServer: unknown }).unityWebglServer).toBeNull();
  });
});
