import path from "node:path";
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

const embeddedRuntimeMock = vi.hoisted(() => {
  return {
    hasArchive: false,
    runtimeDir: "C:\\Vault\\.obsidian\\plugins\\reverysky-map\\.reverysky-runtime\\1.4.1\\unity-webgl",
    extracted: false,
    resolveRuntimeDirectory: vi.fn(),
    reset() {
      this.hasArchive = false;
      this.extracted = false;
      this.resolveRuntimeDirectory.mockReset();
      this.resolveRuntimeDirectory.mockImplementation(() => Promise.resolve({
        runtimeDir: this.runtimeDir,
        extracted: this.extracted
      }));
    }
  };
});

const whatsNewFileMock = vi.hoisted(() => {
  return {
    file: null as null | {
      version: string;
      markdown: string;
      sourcePath: string;
    },
    readWhatsNewFile: vi.fn(),
    reset() {
      this.file = null;
      this.readWhatsNewFile.mockReset();
      this.readWhatsNewFile.mockImplementation(() => Promise.resolve(this.file));
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
  hasEmbeddedUnityRuntimeArchive: () => embeddedRuntimeMock.hasArchive
}));

vi.mock("../src/runtime/EmbeddedUnityRuntimeInstaller", () => ({
  EmbeddedUnityRuntimeInstaller: vi.fn().mockImplementation(function MockEmbeddedUnityRuntimeInstaller() {
    return {
      resolveRuntimeDirectory: embeddedRuntimeMock.resolveRuntimeDirectory
    };
  })
}));

vi.mock("../src/runtime/WhatsNewFile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/runtime/WhatsNewFile")>();
  return {
    ...actual,
    readWhatsNewFile: whatsNewFileMock.readWhatsNewFile
  };
});

vi.mock("../src/runtime/EmbeddedUnityIndexHtml", () => ({
  getEmbeddedUnityIndexHtml: () => null
}));

import ReverySkyMapPlugin from "../src/main";
import { forwardFocusToViews } from "../src/commands/MapCommands";
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
  whatsNewLeaf?: MockLeaf;
}) {
  const existingLeaves = options?.existingLeaves ?? [];
  const rightLeaf = options?.rightLeaf ?? null;
  const whatsNewLeaf = options?.whatsNewLeaf ?? {
    setViewState: vi.fn().mockResolvedValue(undefined)
  };
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
  const getLeaf = vi.fn().mockReturnValue(whatsNewLeaf);
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
        getLeaf,
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
    manifest: { id: "reverysky-map", version: "1.4.1" },
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
    getLeaf,
    revealLeaf,
    detachLeavesOfType,
    loadData,
    saveData,
    whatsNewLeaf
  };
}

describe("ReverySkyMapPlugin map view state persistence", () => {
  beforeEach(() => {
    runtimeServerMock.reset();
    embeddedRuntimeMock.reset();
    whatsNewFileMock.reset();
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

  it("resolves the persisted landmark source with a default fallback", async () => {
    const harness = createPluginHarness({
      loadDataResult: {
        mapViewState: {
          landmarkSource: "  people  "
        }
      }
    });

    await harness.plugin.onload();
    expect(harness.plugin.getLandmarkSource()).toBe("people");

    (harness.plugin as unknown as { updateMapViewState: (state: Record<string, unknown>) => void }).updateMapViewState({
      landmarkSource: "   "
    });
    expect(harness.plugin.getLandmarkSource()).toBe("landmarks");
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

    expect(harness.addCommand).toHaveBeenCalledTimes(3);
    expect(harness.addCommand.mock.calls[2]?.[0]).toMatchObject({
      id: "copy-screenshot",
      name: "Copy screenshot"
    });

    await (harness.addCommand.mock.calls[2]?.[0]?.callback as () => Promise<void>)();

    expect(copyRuntimeScreenshotToClipboard).toHaveBeenCalledTimes(1);
  });

  it("registers a close command that closes an open map leaf", async () => {
    const activeLeaf: MockLeaf = {
      setViewState: vi.fn()
    };
    const harness = createPluginHarness({
      existingLeaves: [activeLeaf]
    });

    await harness.plugin.onload();
    (harness.plugin as unknown as { updateMapViewState: (state: Record<string, unknown>) => void }).updateMapViewState({
      filterQuery: "tag:#close-test"
    });

    expect(harness.addCommand).toHaveBeenCalledTimes(3);
    expect(harness.addCommand.mock.calls[1]?.[0]).toMatchObject({
      id: "close-map",
      name: "Close"
    });

    await (harness.addCommand.mock.calls[1]?.[0]?.callback as () => Promise<void>)();

    expect(harness.saveData).toHaveBeenCalledWith({
      mapViewState: {
        filterQuery: "tag:#close-test"
      }
    });
    expect(harness.detachLeavesOfType).toHaveBeenCalledWith(MAP_VIEW_TYPE);
  });

  it("routes editor focus requests to open map views", async () => {
    const focusA = vi.fn();
    const focusB = vi.fn();
    const mapLeaves = [
      { view: { requestFocusFromEditor: focusA } },
      { view: { requestFocusFromEditor: focusB } }
    ];
    const harness = createPluginHarness({
      existingLeaves: mapLeaves as never[]
    });

    await harness.plugin.onload();
    forwardFocusToViews(harness.plugin, "Folder/Note.md");

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

  it("opens and persists What's New after a fresh embedded archive extraction", async () => {
    embeddedRuntimeMock.hasArchive = true;
    embeddedRuntimeMock.extracted = true;
    whatsNewFileMock.file = {
      version: "1.4.1",
      markdown: "# What's New\n",
      sourcePath: "whats-new/1.4.1.md"
    };
    const whatsNewLeaf: MockLeaf = {
      setViewState: vi.fn().mockResolvedValue(undefined)
    };
    const harness = createPluginHarness({
      whatsNewLeaf
    });

    await harness.plugin.onload();
    await harness.plugin.getUnityRuntimeUrl();

    await vi.waitFor(() => {
      expect(whatsNewLeaf.setViewState).toHaveBeenCalledTimes(1);
    });

    expect(embeddedRuntimeMock.resolveRuntimeDirectory).toHaveBeenCalledWith(
      path.join("C:\\Vault", ".obsidian", "plugins", "reverysky-map"),
      "1.4.1"
    );
    expect(whatsNewFileMock.readWhatsNewFile).toHaveBeenCalledWith(embeddedRuntimeMock.runtimeDir);
    expect(whatsNewLeaf.setViewState).toHaveBeenCalledWith({
      type: "reverysky-whats-new-view",
      active: true,
      state: {
        version: "1.4.1",
        markdown: "# What's New\n",
        sourcePath: "whats-new/1.4.1.md"
      }
    });
    expect(harness.revealLeaf).toHaveBeenCalledWith(whatsNewLeaf);
    await vi.waitFor(() => {
      expect(harness.saveData).toHaveBeenCalledWith({
        mapViewState: undefined,
        whatsNewShownVersion: "1.4.1"
      });
    });
  });

  it("serializes plugin data saves so the What's New marker survives a pending map state save", async () => {
    embeddedRuntimeMock.hasArchive = true;
    embeddedRuntimeMock.extracted = true;
    whatsNewFileMock.file = {
      version: "1.4.1",
      markdown: "# What's New\n",
      sourcePath: "whats-new/1.4.1.md"
    };
    const whatsNewLeaf: MockLeaf = {
      setViewState: vi.fn().mockResolvedValue(undefined)
    };
    const harness = createPluginHarness({
      whatsNewLeaf
    });
    let resolveFirstSave: (() => void) | null = null;
    harness.saveData.mockImplementation(() => {
      if (!resolveFirstSave) {
        return new Promise<void>((resolve) => {
          resolveFirstSave = resolve;
        });
      }

      return Promise.resolve();
    });

    await harness.plugin.onload();
    (harness.plugin as unknown as { updateMapViewState: (state: Record<string, unknown>) => void }).updateMapViewState({
      filterQuery: "tag:#pending-save",
      showTags: true
    });
    await vi.waitFor(() => {
      expect(harness.saveData).toHaveBeenCalledTimes(1);
    });

    await harness.plugin.getUnityRuntimeUrl();
    await vi.waitFor(() => {
      expect(whatsNewLeaf.setViewState).toHaveBeenCalledTimes(1);
    });
    expect(harness.saveData).toHaveBeenCalledTimes(1);

    resolveFirstSave?.();

    await vi.waitFor(() => {
      expect(harness.saveData).toHaveBeenCalledTimes(2);
    });
    expect(harness.saveData.mock.calls[0]?.[0]).toEqual({
      mapViewState: {
        filterQuery: "tag:#pending-save",
        showTags: true
      }
    });
    expect(harness.saveData.mock.calls[1]?.[0]).toEqual({
      mapViewState: {
        filterQuery: "tag:#pending-save",
        showTags: true
      },
      whatsNewShownVersion: "1.4.1"
    });
  });

  it("does not read What's New when an embedded archive cache is reused", async () => {
    embeddedRuntimeMock.hasArchive = true;
    embeddedRuntimeMock.extracted = false;
    const harness = createPluginHarness();

    await harness.plugin.onload();
    await harness.plugin.getUnityRuntimeUrl();

    expect(whatsNewFileMock.readWhatsNewFile).not.toHaveBeenCalled();
    expect(harness.getLeaf).not.toHaveBeenCalled();
    expect(harness.saveData).not.toHaveBeenCalled();
  });

  it("does not reopen an already shown What's New version after extraction", async () => {
    embeddedRuntimeMock.hasArchive = true;
    embeddedRuntimeMock.extracted = true;
    whatsNewFileMock.file = {
      version: "1.4.1",
      markdown: "# What's New\n",
      sourcePath: "whats-new/1.4.1.md"
    };
    const harness = createPluginHarness({
      loadDataResult: {
        whatsNewShownVersion: "1.4.1"
      }
    });

    await harness.plugin.onload();
    await harness.plugin.getUnityRuntimeUrl();

    await vi.waitFor(() => {
      expect(whatsNewFileMock.readWhatsNewFile).toHaveBeenCalledTimes(1);
    });
    expect(harness.getLeaf).not.toHaveBeenCalled();
    expect(harness.saveData).not.toHaveBeenCalled();
  });

  it("opens a newer What's New version after skipped plugin versions", async () => {
    embeddedRuntimeMock.hasArchive = true;
    embeddedRuntimeMock.extracted = true;
    whatsNewFileMock.file = {
      version: "1.10.0",
      markdown: "# Newer\n",
      sourcePath: "whats-new/1.10.0.md"
    };
    const whatsNewLeaf: MockLeaf = {
      setViewState: vi.fn().mockResolvedValue(undefined)
    };
    const harness = createPluginHarness({
      loadDataResult: {
        whatsNewShownVersion: "1.9.9"
      },
      whatsNewLeaf
    });

    await harness.plugin.onload();
    await harness.plugin.getUnityRuntimeUrl();

    await vi.waitFor(() => {
      expect(whatsNewLeaf.setViewState).toHaveBeenCalledTimes(1);
    });
    expect(whatsNewLeaf.setViewState).toHaveBeenCalledWith({
      type: "reverysky-whats-new-view",
      active: true,
      state: {
        version: "1.10.0",
        markdown: "# Newer\n",
        sourcePath: "whats-new/1.10.0.md"
      }
    });
    await vi.waitFor(() => {
      expect(harness.saveData).toHaveBeenCalledWith({
        mapViewState: undefined,
        whatsNewShownVersion: "1.10.0"
      });
    });
  });

  it("does not reopen older What's New after rollback or downgrade", async () => {
    embeddedRuntimeMock.hasArchive = true;
    embeddedRuntimeMock.extracted = true;
    whatsNewFileMock.file = {
      version: "1.4.1",
      markdown: "# Older\n",
      sourcePath: "whats-new/1.4.1.md"
    };
    const harness = createPluginHarness({
      loadDataResult: {
        whatsNewShownVersion: "1.5.0"
      }
    });

    await harness.plugin.onload();
    await harness.plugin.getUnityRuntimeUrl();

    await vi.waitFor(() => {
      expect(whatsNewFileMock.readWhatsNewFile).toHaveBeenCalledTimes(1);
    });
    expect(harness.getLeaf).not.toHaveBeenCalled();
    expect(harness.saveData).not.toHaveBeenCalled();
  });

  it("opens What's New on first install or old data without a shown version", async () => {
    embeddedRuntimeMock.hasArchive = true;
    embeddedRuntimeMock.extracted = true;
    whatsNewFileMock.file = {
      version: "1.4.1",
      markdown: "# First run\n",
      sourcePath: "whats-new/1.4.1.md"
    };
    const whatsNewLeaf: MockLeaf = {
      setViewState: vi.fn().mockResolvedValue(undefined)
    };
    const harness = createPluginHarness({
      loadDataResult: {
        mapViewState: {
          filterQuery: "tag:#saved",
          showTags: true
        }
      },
      whatsNewLeaf
    });

    await harness.plugin.onload();
    await harness.plugin.getUnityRuntimeUrl();

    await vi.waitFor(() => {
      expect(whatsNewLeaf.setViewState).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(harness.saveData).toHaveBeenCalledWith({
        mapViewState: {
          filterQuery: "tag:#saved",
          showTags: true
        },
        whatsNewShownVersion: "1.4.1"
      });
    });
  });
});
