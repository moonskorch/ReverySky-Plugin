import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphPayload } from "../../src/bridge/BridgeTypes";
import type { ReverySkyMapViewDependencies } from "../../src/view/ReverySkyMapView";

import { ReverySkyMapView } from "../../src/view/ReverySkyMapView";

type BridgeCallbacks = {
  onReady?: () => void;
  onNoteOpen?: (payload: { id?: string; path?: string }) => void;
  onError?: (message: string) => void;
};

function makePayload(): GraphPayload {
  return {
    graphVersion: "0.0.1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    vault: { noteCount: 1 },
    notes: [
      {
        id: "note_1",
        path: "Note.md",
        title: "Note",
        tags: [],
        dates: {}
      }
    ],
    links: []
  };
}

describe("ReverySkyMapView bridge integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates iframe on open, wires bridge handshake, and detaches/cleans on close", async () => {
    const app = {
      marker: "app",
      workspace: {
        activeLeaf: null,
        getMostRecentLeaf: vi.fn().mockReturnValue(null),
        getLeavesOfType: vi.fn().mockReturnValue([]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    };
    const plugin = {
      getUnityRuntimeUrl: vi.fn().mockResolvedValue("http://127.0.0.1:7777/index.html")
    };

    const callbacks: BridgeCallbacks = {};
    const bridge = {
      attach: vi.fn((_: Window, received: BridgeCallbacks) => {
        callbacks.onReady = received.onReady;
        callbacks.onError = received.onError;
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn()
    };

    const payload = makePayload();
    const buildGraph = vi.fn().mockReturnValue(payload);
    const notify = vi.fn();

    const deps: ReverySkyMapViewDependencies = {
      createBridge: () => bridge,
      buildGraph: buildGraph as (app: never) => GraphPayload,
      notify,
      now: () => 1700000000000
    };

    const view = new ReverySkyMapView({ app } as never, plugin as never, deps);
    await view.onOpen();

    const iframe = view.contentEl.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("http://127.0.0.1:7777/index.html?t=1700000000000");

    const fakeContentWindow = { postMessage: vi.fn() } as unknown as Window;
    Object.defineProperty(iframe!, "contentWindow", {
      value: fakeContentWindow,
      configurable: true
    });

    iframe!.dispatchEvent(new Event("load"));

    expect(bridge.attach).toHaveBeenCalledTimes(1);
    expect(bridge.attach).toHaveBeenCalledWith(fakeContentWindow, expect.any(Object));

    callbacks.onReady?.();

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(buildGraph).toHaveBeenCalledWith(app);
    expect(bridge.sendGraphSet).toHaveBeenCalledWith(payload);

    await view.onClose();

    expect(bridge.detach).toHaveBeenCalledTimes(1);
    expect(view.contentEl.childElementCount).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("opens note on note:open by id with path fallback", async () => {
    const activeLeaf = {
      view: {
        getViewType: () => "markdown"
      }
    };
    const openLinkText = vi.fn().mockResolvedValue(undefined);
    const app = {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) => {
          if (path === "Folder/Note.md" || path === "Fallback/Other.md") {
            return { path };
          }
          return null;
        })
      },
      workspace: {
        activeLeaf,
        openLinkText,
        getMostRecentLeaf: vi.fn().mockReturnValue(activeLeaf),
        getLeavesOfType: vi.fn().mockReturnValue([activeLeaf]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    };
    const plugin = {
      getUnityRuntimeUrl: vi.fn().mockResolvedValue("http://127.0.0.1:7777/index.html")
    };

    const callbacks: BridgeCallbacks = {};
    const bridge = {
      attach: vi.fn((_: Window, received: BridgeCallbacks) => {
        callbacks.onReady = received.onReady;
        callbacks.onNoteOpen = received.onNoteOpen;
        callbacks.onError = received.onError;
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn()
    };

    const payload = makePayload();
    payload.notes[0].id = "note_abc";
    payload.notes[0].path = "Folder/Note.md";
    const buildGraph = vi.fn().mockReturnValue(payload);
    const notify = vi.fn();

    const deps: ReverySkyMapViewDependencies = {
      createBridge: () => bridge,
      buildGraph: buildGraph as (app: never) => GraphPayload,
      notify,
      now: () => 1700000000000
    };

    const view = new ReverySkyMapView({ app } as never, plugin as never, deps);
    await view.onOpen();

    const iframe = view.contentEl.querySelector("iframe");
    const fakeContentWindow = { postMessage: vi.fn() } as unknown as Window;
    Object.defineProperty(iframe!, "contentWindow", {
      value: fakeContentWindow,
      configurable: true
    });
    iframe!.dispatchEvent(new Event("load"));
    callbacks.onReady?.();

    callbacks.onNoteOpen?.({ id: "note_abc" });
    await Promise.resolve();

    callbacks.onNoteOpen?.({
      id: "missing",
      path: "Fallback/Other.md"
    });
    await Promise.resolve();

    expect(openLinkText).toHaveBeenCalledTimes(2);
    expect(openLinkText.mock.calls[0]?.[0]).toBe("Folder/Note.md");
    expect(openLinkText.mock.calls[1]?.[0]).toBe("Fallback/Other.md");
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not open note inside map leaf when active leaf is map", async () => {
    const markdownLeaf = {
      view: {
        getViewType: () => "markdown"
      }
    };
    const mapLeaf = {
      view: {
        getViewType: () => "reverysky-map-view"
      }
    };
    const openLinkText = vi.fn().mockResolvedValue(undefined);

    let onActiveLeafChange: ((leaf: unknown) => void) | null = null;
    const app = {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) => (path === "Folder/Note.md" ? { path } : null))
      },
      workspace: {
        activeLeaf: mapLeaf,
        openLinkText,
        getMostRecentLeaf: vi.fn().mockReturnValue(mapLeaf),
        getLeavesOfType: vi.fn((viewType: string) => (viewType === "markdown" ? [markdownLeaf] : [])),
        iterateAllLeaves: vi.fn(),
        on: vi.fn((_eventName: string, callback: (leaf: unknown) => void) => {
          onActiveLeafChange = callback;
          return { id: "event-ref" };
        })
      }
    };
    const plugin = {
      getUnityRuntimeUrl: vi.fn().mockResolvedValue("http://127.0.0.1:7777/index.html")
    };

    const callbacks: BridgeCallbacks = {};
    const bridge = {
      attach: vi.fn((_: Window, received: BridgeCallbacks) => {
        callbacks.onReady = received.onReady;
        callbacks.onNoteOpen = received.onNoteOpen;
        callbacks.onError = received.onError;
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn()
    };

    const payload = makePayload();
    payload.notes[0].id = "note_abc";
    payload.notes[0].path = "Folder/Note.md";

    const view = new ReverySkyMapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: vi.fn().mockReturnValue(payload) as (app: never) => GraphPayload,
        notify: vi.fn(),
        now: () => 1700000000000
      }
    );
    await view.onOpen();

    const iframe = view.contentEl.querySelector("iframe");
    Object.defineProperty(iframe!, "contentWindow", {
      value: { postMessage: vi.fn() } as unknown as Window,
      configurable: true
    });
    iframe!.dispatchEvent(new Event("load"));
    callbacks.onReady?.();

    onActiveLeafChange?.(markdownLeaf);
    callbacks.onNoteOpen?.({ id: "note_abc" });
    await Promise.resolve();

    expect(openLinkText).toHaveBeenCalledTimes(1);
    expect(openLinkText.mock.calls[0]?.[0]).toBe("Folder/Note.md");
    expect(openLinkText.mock.calls[0]?.[3]).toMatchObject({
      active: true,
      group: markdownLeaf
    });
  });

  it("falls back to native openLinkText when no markdown leaf exists", async () => {
    const mapLeaf = {
      view: {
        getViewType: () => "reverysky-map-view"
      }
    };
    const openLinkText = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();
    const app = {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) => (path === "Folder/Note.md" ? { path } : null))
      },
      workspace: {
        activeLeaf: mapLeaf,
        openLinkText,
        getMostRecentLeaf: vi.fn().mockReturnValue(mapLeaf),
        getLeavesOfType: vi.fn().mockReturnValue([]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    };
    const plugin = {
      getUnityRuntimeUrl: vi.fn().mockResolvedValue("http://127.0.0.1:7777/index.html")
    };

    const callbacks: BridgeCallbacks = {};
    const bridge = {
      attach: vi.fn((_: Window, received: BridgeCallbacks) => {
        callbacks.onReady = received.onReady;
        callbacks.onNoteOpen = received.onNoteOpen;
        callbacks.onError = received.onError;
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn()
    };

    const payload = makePayload();
    payload.notes[0].id = "note_abc";
    payload.notes[0].path = "Folder/Note.md";

    const view = new ReverySkyMapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: vi.fn().mockReturnValue(payload) as (app: never) => GraphPayload,
        notify,
        now: () => 1700000000000
      }
    );
    await view.onOpen();

    const iframe = view.contentEl.querySelector("iframe");
    Object.defineProperty(iframe!, "contentWindow", {
      value: { postMessage: vi.fn() } as unknown as Window,
      configurable: true
    });
    iframe!.dispatchEvent(new Event("load"));
    callbacks.onReady?.();

    callbacks.onNoteOpen?.({ id: "note_abc" });
    await Promise.resolve();

    expect(openLinkText).toHaveBeenCalledTimes(1);
    expect(openLinkText.mock.calls[0]?.[0]).toBe("Folder/Note.md");
    expect(openLinkText.mock.calls[0]?.[3]).toMatchObject({
      active: true
    });
    expect(openLinkText.mock.calls[0]?.[3]).not.toHaveProperty("group");
    expect(notify).not.toHaveBeenCalled();
  });
});
