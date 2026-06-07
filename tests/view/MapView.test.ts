import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphPayload } from "../../src/bridge/BridgeTypes";
import type { MapViewDependencies } from "../../src/view/MapView";

import { MapView } from "../../src/view/MapView";

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
        date: "2026-01-01T00:00:00.000Z",
        size: 64
      }
    ],
    links: [],
    enginePreference: "auto"
  };
}

function makePathPayload(): GraphPayload {
  return {
    graphVersion: "0.0.1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    vault: { noteCount: 3 },
    notes: [
      {
        id: "daily",
        path: "Notes/Daily/2026-01-01.md",
        title: "Daily",
        tags: ["daily", "journal/daily"],
        size: 20
      },
      {
        id: "project",
        path: "Projects/ReverySky/Spec.md",
        title: "Spec",
        tags: ["work/subtag", "project"],
        size: 21
      },
      {
        id: "archive",
        path: "Archive/Old.md",
        title: "Old",
        tags: ["archive"],
        size: 22
      }
    ],
    links: [
      { sourceId: "daily", targetId: "project", kind: "resolved" },
      { sourceId: "project", targetId: "archive", kind: "resolved" }
    ],
    enginePreference: "auto"
  };
}

describe("MapView bridge integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
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
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePayload();
    const buildGraph = vi.fn().mockReturnValue(payload);
    const notify = vi.fn();

    const deps: MapViewDependencies = {
      createBridge: () => bridge,
      buildGraph: buildGraph as (app: never) => GraphPayload,
      notify,
      now: () => 1700000000000
    };

    const view = new MapView({ app } as never, plugin as never, deps);
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
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePayload();
    payload.notes[0].id = "note_abc";
    payload.notes[0].path = "Folder/Note.md";
    const buildGraph = vi.fn().mockReturnValue(payload);
    const notify = vi.fn();

    const deps: MapViewDependencies = {
      createBridge: () => bridge,
      buildGraph: buildGraph as (app: never) => GraphPayload,
      notify,
      now: () => 1700000000000
    };

    const view = new MapView({ app } as never, plugin as never, deps);
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
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePayload();
    payload.notes[0].id = "note_abc";
    payload.notes[0].path = "Folder/Note.md";

    const view = new MapView(
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
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePayload();
    payload.notes[0].id = "note_abc";
    payload.notes[0].path = "Folder/Note.md";

    const view = new MapView(
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

  it("coalesces graph-significant changes and ignores plain text edits", async () => {
    vi.useFakeTimers();

    const metadataCallbacks: {
      changed?: (file: { path?: string }, data: string, cache: { links?: Array<{ link: string }>; tags?: Array<{ tag: string }> }) => void;
      resolved?: () => void;
    } = {};

    const app = {
      metadataCache: {
        on: vi.fn((name: "changed" | "resolved", callback: (...args: never[]) => void) => {
          if (name === "changed") {
            metadataCallbacks.changed = callback as (
              file: { path?: string },
              data: string,
              cache: { links?: Array<{ link: string }>; tags?: Array<{ tag: string }> }
            ) => void;
          } else {
            metadataCallbacks.resolved = callback as () => void;
          }
          return { id: `metadata-${name}` };
        })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePayload();
    const buildGraph = vi.fn().mockReturnValue(payload);
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: buildGraph as (app: never) => GraphPayload,
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

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(1);

    metadataCallbacks.changed?.(
      { path: "Folder/Note.md" },
      "hello world",
      { links: [{ link: "RefA" }], tags: [{ tag: "#tag-a" }] }
    );
    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(2);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(2);

    metadataCallbacks.changed?.(
      { path: "Folder/Note.md" },
      "hello world!!!",
      { links: [{ link: "RefA" }], tags: [{ tag: "#tag-a" }] }
    );
    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(2);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(2);
  });

  it("does not refresh when only frontmatter date changes and tags/links stay stable", async () => {
    vi.useFakeTimers();

    const metadataCallbacks: {
      changed?: (
        file: { path?: string },
        data: string,
        cache: {
          links?: Array<{ link: string }>;
          tags?: Array<{ tag: string }>;
          frontmatter?: { date?: string; tags?: unknown };
        }
      ) => void;
      resolved?: () => void;
    } = {};

    const app = {
      metadataCache: {
        on: vi.fn((name: "changed" | "resolved", callback: (...args: never[]) => void) => {
          if (name === "changed") {
            metadataCallbacks.changed = callback as (
              file: { path?: string },
              data: string,
              cache: {
                links?: Array<{ link: string }>;
                tags?: Array<{ tag: string }>;
                frontmatter?: { date?: string; tags?: unknown };
              }
            ) => void;
          } else {
            metadataCallbacks.resolved = callback as () => void;
          }
          return { id: `metadata-${name}` };
        })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePayload();
    const buildGraph = vi.fn().mockReturnValue(payload);
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: buildGraph as (app: never) => GraphPayload,
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

    expect(buildGraph).toHaveBeenCalledTimes(1);

    metadataCallbacks.changed?.(
      { path: "Folder/Note.md" },
      "content",
      {
        links: [{ link: "RefA" }],
        tags: [{ tag: "#tag-a" }],
        frontmatter: { date: "2026-01-01" }
      }
    );
    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);
    expect(buildGraph).toHaveBeenCalledTimes(2);

    metadataCallbacks.changed?.(
      { path: "Folder/Note.md" },
      "content",
      {
        links: [{ link: "RefA" }],
        tags: [{ tag: "#tag-a" }],
        frontmatter: { date: "2030-12-31" }
      }
    );
    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(2);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(2);
  });

  it("does not refresh when only note size changes and graph signature stays stable", async () => {
    vi.useFakeTimers();

    const metadataCallbacks: {
      changed?: (
        file: { path?: string },
        data: string,
        cache: {
          links?: Array<{ link: string }>;
          tags?: Array<{ tag: string }>;
          frontmatter?: { date?: string; tags?: unknown };
        }
      ) => void;
      resolved?: () => void;
    } = {};

    const app = {
      metadataCache: {
        on: vi.fn((name: "changed" | "resolved", callback: (...args: never[]) => void) => {
          if (name === "changed") {
            metadataCallbacks.changed = callback as (
              file: { path?: string },
              data: string,
              cache: {
                links?: Array<{ link: string }>;
                tags?: Array<{ tag: string }>;
                frontmatter?: { date?: string; tags?: unknown };
              }
            ) => void;
          } else {
            metadataCallbacks.resolved = callback as () => void;
          }
          return { id: `metadata-${name}` };
        })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePayload();
    const buildGraph = vi.fn().mockReturnValue(payload);
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: buildGraph as (app: never) => GraphPayload,
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

    expect(buildGraph).toHaveBeenCalledTimes(1);

    metadataCallbacks.changed?.(
      { path: "Folder/Note.md" },
      "size-prime",
      {
        links: [{ link: "RefA" }],
        tags: [{ tag: "#tag-a" }],
        frontmatter: { date: "2026-01-01" }
      }
    );
    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);
    expect(buildGraph).toHaveBeenCalledTimes(2);

    metadataCallbacks.changed?.(
      { path: "Folder/Note.md" },
      "size-prime and then much longer content to change file size only",
      {
        links: [{ link: "RefA" }],
        tags: [{ tag: "#tag-a" }],
        frontmatter: { date: "2026-01-01" }
      }
    );
    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(2);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(2);
  });

  it("queues latest graph before bridge ready and flushes it on bridge:ready", async () => {
    vi.useFakeTimers();

    const metadataCallbacks: {
      changed?: (file: { path?: string }, data: string, cache: { links?: Array<{ link: string }>; tags?: Array<{ tag: string }> }) => void;
      resolved?: () => void;
    } = {};
    const app = {
      metadataCache: {
        on: vi.fn((name: "changed" | "resolved", callback: (...args: never[]) => void) => {
          if (name === "changed") {
            metadataCallbacks.changed = callback as (
              file: { path?: string },
              data: string,
              cache: { links?: Array<{ link: string }>; tags?: Array<{ tag: string }> }
            ) => void;
          } else {
            metadataCallbacks.resolved = callback as () => void;
          }
          return { id: `metadata-${name}` };
        })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const queuedPayload = makePayload();
    queuedPayload.notes[0].id = "queued";
    const buildGraph = vi.fn().mockReturnValue(queuedPayload);
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: buildGraph as (app: never) => GraphPayload,
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

    metadataCallbacks.changed?.(
      { path: "Folder/Note.md" },
      "content changed",
      { links: [{ link: "RefA" }], tags: [{ tag: "#tag-a" }] }
    );
    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(0);

    callbacks.onReady?.();

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledWith(queuedPayload);
  });

  it("focuses a newly created note unless user switched to another active note first", async () => {
    vi.useFakeTimers();

    let onActiveLeafChange: ((leaf: unknown) => void) | null = null;
    const vaultCallbacks: {
      create?: (file: { path?: string }) => void;
    } = {};

    const activeLeafA = {
      view: {
        getViewType: () => "markdown",
        file: { path: "Folder/A.md" }
      }
    };
    const activeLeafB = {
      view: {
        getViewType: () => "markdown",
        file: { path: "Folder/B.md" }
      }
    };

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn((name: "create" | "delete" | "rename", callback: (...args: never[]) => void) => {
          if (name === "create") {
            vaultCallbacks.create = callback as (file: { path?: string }) => void;
          }
          return { id: `vault-${name}` };
        }),
        getAbstractFileByPath: vi.fn()
      },
      workspace: {
        activeLeaf: activeLeafA,
        getMostRecentLeaf: vi.fn().mockReturnValue(activeLeafA),
        getLeavesOfType: vi.fn().mockReturnValue([activeLeafA]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn((eventName: string, callback: (leaf: unknown) => void) => {
          if (eventName === "active-leaf-change") {
            onActiveLeafChange = callback;
          }
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePayload();
    payload.notes = [
      { id: "a", path: "Folder/A.md", title: "A", tags: [], date: "2026-01-01T00:00:00.000Z", size: 10 },
      { id: "b", path: "Folder/B.md", title: "B", tags: [], date: "2026-01-02T00:00:00.000Z", size: 20 },
      { id: "new", path: "Folder/New.md", title: "New", tags: [], date: "2026-01-03T00:00:00.000Z", size: 30 }
    ];
    payload.vault.noteCount = payload.notes.length;

    const view = new MapView(
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

    expect(bridge.sendNoteFocus).toHaveBeenLastCalledWith({
      id: "a",
      path: "Folder/A.md"
    });

    vaultCallbacks.create?.({ path: "Folder/New.md" });
    onActiveLeafChange?.(activeLeafB);
    vi.advanceTimersByTime(250);

    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(2);
    expect(bridge.sendNoteFocus).toHaveBeenLastCalledWith({
      id: "b",
      path: "Folder/B.md"
    });
  });

  it("preserves focus on active note after rename commit", async () => {
    vi.useFakeTimers();

    const vaultCallbacks: {
      rename?: (file: { path?: string }, oldPath: string) => void;
    } = {};

    const activeLeaf = {
      view: {
        getViewType: () => "markdown",
        file: { path: "Folder/Old.md" }
      }
    };

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn((name: "create" | "delete" | "rename", callback: (...args: never[]) => void) => {
          if (name === "rename") {
            vaultCallbacks.rename = callback as (file: { path?: string }, oldPath: string) => void;
          }
          return { id: `vault-${name}` };
        }),
        getAbstractFileByPath: vi.fn()
      },
      workspace: {
        activeLeaf,
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payloadBefore = makePayload();
    payloadBefore.notes = [
      { id: "old_id", path: "Folder/Old.md", title: "Old", tags: [], date: "2026-01-01T00:00:00.000Z", size: 11 }
    ];
    payloadBefore.vault.noteCount = 1;

    const payloadAfter = makePayload();
    payloadAfter.notes = [
      { id: "new_id", path: "Folder/New.md", title: "New", tags: [], date: "2026-01-02T00:00:00.000Z", size: 12 }
    ];
    payloadAfter.vault.noteCount = 1;

    const buildGraph = vi
      .fn()
      .mockReturnValueOnce(payloadBefore)
      .mockReturnValueOnce(payloadAfter);

    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: buildGraph as (app: never) => GraphPayload,
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

    expect(bridge.sendNoteFocus).toHaveBeenLastCalledWith({
      id: "old_id",
      path: "Folder/Old.md"
    });

    vaultCallbacks.rename?.({ path: "Folder/New.md" }, "Folder/Old.md");
    vi.advanceTimersByTime(250);

    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(2);
    expect(bridge.sendNoteFocus).toHaveBeenLastCalledWith({
      id: "new_id",
      path: "Folder/New.md"
    });
  });

  it("filters graph:set by path query without rebuilding source graph", async () => {
    vi.useFakeTimers();

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    const buildGraph = vi.fn().mockReturnValue(payload);
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: buildGraph as (app: never) => GraphPayload,
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

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(1);
    const initialPayload = bridge.sendGraphSet.mock.calls[0]?.[0] as GraphPayload;
    expect(initialPayload.vault.noteCount).toBe(3);

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    searchInput.value = "path:daily";
    searchInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(2);
    const filteredPayload = bridge.sendGraphSet.mock.calls[1]?.[0] as GraphPayload;
    expect(filteredPayload.vault.noteCount).toBe(1);
    expect(filteredPayload.notes.map((note) => note.id)).toEqual(["daily"]);

    const filterMessage = view.contentEl.querySelector(
      ".reverysky-map-filter-message"
    ) as HTMLElement;
    expect(filterMessage.style.display).toBe("none");

    searchInput.value = 'path:"';
    searchInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(250);

    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(2);
    expect(filterMessage.style.display).toBe("none");
  });

  it("toggles tags visibility in outgoing graph payload without rebuilding source graph", async () => {
    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    payload.notes[0].tags = ["daily", "journal"];
    payload.notes[1].tags = ["project"];
    payload.notes[2].tags = ["archive"];
    const buildGraph = vi.fn().mockReturnValue(payload);

    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: buildGraph as (app: never) => GraphPayload,
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

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(1);
    const initialPayload = bridge.sendGraphSet.mock.calls[0]?.[0] as GraphPayload;
    expect(initialPayload.notes.map((note) => note.tags)).toEqual([
      ["daily", "journal"],
      ["project"],
      ["archive"]
    ]);

    const tagsToggle = view.contentEl.querySelector(
      ".reverysky-map-tags-toggle"
    ) as HTMLButtonElement;
    expect(tagsToggle.getAttribute("aria-checked")).toBe("true");

    tagsToggle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(2);
    const tagsHiddenPayload = bridge.sendGraphSet.mock.calls[1]?.[0] as GraphPayload;
    expect(tagsHiddenPayload.notes.every((note) => note.tags.length === 0)).toBe(true);
    expect(tagsHiddenPayload.links).toEqual(initialPayload.links);
    expect(tagsHiddenPayload.vault.noteCount).toBe(initialPayload.vault.noteCount);
    expect(tagsToggle.getAttribute("aria-checked")).toBe("false");

    tagsToggle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(3);
    const tagsVisibleAgainPayload = bridge.sendGraphSet.mock.calls[2]?.[0] as GraphPayload;
    expect(tagsVisibleAgainPayload.notes.map((note) => note.tags)).toEqual([
      ["daily", "journal"],
      ["project"],
      ["archive"]
    ]);
    expect(tagsToggle.getAttribute("aria-checked")).toBe("true");
  });

  it("updates engine preference in outgoing graph payload without rebuilding source graph", async () => {
    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    const buildGraph = vi.fn().mockReturnValue(payload);
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: buildGraph as (app: never) => GraphPayload,
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

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(1);
    const initialPayload = bridge.sendGraphSet.mock.calls[0]?.[0] as GraphPayload;
    expect(initialPayload.enginePreference).toBe("auto");

    const engineSelect = view.contentEl.querySelector(
      ".reverysky-map-engine-select"
    ) as HTMLSelectElement;
    expect(engineSelect.value).toBe("auto");

    engineSelect.value = "forces";
    engineSelect.dispatchEvent(new Event("change"));
    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(2);
    const linksPayload = bridge.sendGraphSet.mock.calls[1]?.[0] as GraphPayload;
    expect(linksPayload.enginePreference).toBe("forces");
    expect(engineSelect.value).toBe("forces");

    engineSelect.value = "static25d";
    engineSelect.dispatchEvent(new Event("change"));
    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(3);
    const datesPayload = bridge.sendGraphSet.mock.calls[2]?.[0] as GraphPayload;
    expect(datesPayload.enginePreference).toBe("static25d");
    expect(engineSelect.value).toBe("static25d");
  });

  it("opens filter panel by gear button and closes it by close button", async () => {
    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    const view = new MapView(
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

    const panel = view.contentEl.querySelector(".reverysky-map-filter-panel") as HTMLElement;
    expect(panel.style.display).toBe("none");

    const gear = view.contentEl.querySelector(".reverysky-map-filter-toggle") as HTMLButtonElement;
    gear.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(panel.style.display).toBe("grid");

    const closeButton = view.contentEl.querySelector(
      ".reverysky-map-filter-close"
    ) as HTMLButtonElement;
    closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panel.style.display).toBe("none");
  });

  it("opens and closes filter panel with keyboard activation on focused gear button", async () => {
    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    const view = new MapView(
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

    const panel = view.contentEl.querySelector(".reverysky-map-filter-panel") as HTMLElement;
    expect(panel.style.display).toBe("none");

    const gear = view.contentEl.querySelector(".reverysky-map-filter-toggle") as HTMLButtonElement;
    gear.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(panel.style.display).toBe("grid");

    const closeButton = view.contentEl.querySelector(
      ".reverysky-map-filter-close"
    ) as HTMLButtonElement;
    closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panel.style.display).toBe("none");
  });

  it("shows path filter suggestions on focus and applies path operator on option click", async () => {
    vi.useFakeTimers();

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    payload.notes.push({
      id: "dream",
      path: "Dream Notes/One.md",
      title: "Dream",
      tags: [],
      size: 5
    });
    payload.vault.noteCount = payload.notes.length;
    const view = new MapView(
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

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    const suggestions = view.contentEl.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
    expect(suggestions).not.toBeNull();
    expect(suggestions.style.display).toBe("none");

    searchInput.dispatchEvent(new Event("focus"));
    expect(suggestions.style.display).toBe("block");
    expect(suggestions.textContent).toContain("Search settings");
    expect(suggestions.textContent).toContain("path: match in file path");
    expect(suggestions.textContent).toContain("date: match note date");
    expect(suggestions.textContent).toContain("tag: match note tag");

    const pathOption = view.contentEl.querySelector(
      ".reverysky-map-filter-suggestion-option"
    ) as HTMLElement;
    pathOption.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(searchInput.value).toBe("path:");
    expect(suggestions.style.display).toBe("block");
    expect(suggestions.textContent).toContain("Folders");
    expect(suggestions.textContent).toContain("Notes");
    expect(suggestions.textContent).toContain("Dream Notes");

    const dreamOption = Array.from(
      view.contentEl.querySelectorAll(".reverysky-map-folder-suggestion-option")
    ).find((el) => el.textContent === "Dream Notes") as HTMLButtonElement | undefined;
    expect(dreamOption).toBeDefined();
    dreamOption?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(searchInput.value).toBe("path:\"Dream Notes\"");
    expect(suggestions.style.display).toBe("none");

    searchInput.value = "path:Notes";
    searchInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(250);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(2);
  });

  it("shows tag suggestions and applies tag filter on option click", async () => {
    vi.useFakeTimers();

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    const view = new MapView(
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

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    searchInput.dispatchEvent(new Event("focus"));

    const tagOption = Array.from(
      view.contentEl.querySelectorAll(".reverysky-map-filter-suggestion-option")
    ).find((el) => el.textContent?.includes("tag:")) as HTMLElement | undefined;
    expect(tagOption).toBeDefined();
    tagOption?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    const suggestions = view.contentEl.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
    expect(suggestions.textContent).toContain("Tags");
    expect(suggestions.textContent).toContain("#archive");
    expect(suggestions.textContent).toContain("#daily");
    expect(suggestions.textContent).toContain("#work/subtag");

    const workOption = Array.from(
      view.contentEl.querySelectorAll(".reverysky-map-tag-suggestion-option")
    ).find((el) => el.textContent === "#work/subtag") as HTMLButtonElement | undefined;
    expect(workOption).toBeDefined();
    workOption?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(searchInput.value).toBe("tag:#work/subtag");
    expect(suggestions.style.display).toBe("none");

    vi.advanceTimersByTime(250);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(2);
    const filteredPayload = bridge.sendGraphSet.mock.calls[1]?.[0] as GraphPayload;
    expect(filteredPayload.notes.map((note) => note.id)).toEqual(["project"]);
  });

  it("adds a second tag filter of the same type through suggestions", async () => {
    vi.useFakeTimers();

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    const view = new MapView(
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

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    searchInput.value = "tag:#work";
    searchInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(250);

    searchInput.value = `${searchInput.value} `;
    searchInput.dispatchEvent(new Event("input"));
    searchInput.dispatchEvent(new Event("click"));

    let suggestions = view.contentEl.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
    expect(suggestions.textContent).toContain("Search settings");

    const tagOption = Array.from(
      view.contentEl.querySelectorAll(".reverysky-map-filter-suggestion-option")
    ).find((el) => el.textContent?.includes("tag:")) as HTMLElement | undefined;
    expect(tagOption).toBeDefined();
    tagOption?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    suggestions = view.contentEl.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
    expect(suggestions.textContent).toContain("Tags");

    const projectOption = Array.from(
      view.contentEl.querySelectorAll(".reverysky-map-tag-suggestion-option")
    ).find((el) => el.textContent === "#project") as HTMLButtonElement | undefined;
    expect(projectOption).toBeDefined();
    projectOption?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(searchInput.value).toBe("tag:#work tag:#project");
    expect(suggestions.style.display).toBe("none");

    vi.advanceTimersByTime(250);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(3);
    const filteredPayload = bridge.sendGraphSet.mock.calls[2]?.[0] as GraphPayload;
    expect(filteredPayload.notes.map((note) => note.id)).toEqual(["project"]);
  });

  it("shows date presets and applies date filter on preset click", async () => {
    vi.useFakeTimers();

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    payload.notes[0].date = "2026-01-01T00:00:00.000Z";
    payload.notes[1].date = "2026-01-15T00:00:00.000Z";
    payload.notes[2].date = "2025-01-01T00:00:00.000Z";
    payload.vault.noteCount = payload.notes.length;
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: vi.fn().mockReturnValue(payload) as (app: never) => GraphPayload,
        notify: vi.fn(),
        now: () => Date.UTC(2026, 0, 31, 12, 0, 0)
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

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    searchInput.dispatchEvent(new Event("focus"));
    expect(
      Array.from(view.contentEl.querySelectorAll(".reverysky-map-filter-suggestion-option")).length
    ).toBeGreaterThan(1);

    const dateOption = Array.from(
      view.contentEl.querySelectorAll(".reverysky-map-filter-suggestion-option")
    ).find((el) => el.textContent?.includes("date:")) as HTMLElement | undefined;
    expect(dateOption).toBeDefined();
    dateOption?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    const suggestions = view.contentEl.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
    expect(suggestions.textContent).toContain("Date presets");
    expect(suggestions.textContent).toContain("date:2026-01-31");
    expect(suggestions.textContent).toContain("date:>=2026-01-24");
    expect(suggestions.textContent).toContain("date:>=2025-12-31");
    expect(suggestions.textContent).toContain("date:>=2025-01-31");
    const firstDatePreset = view.contentEl.querySelector(
      ".reverysky-map-date-suggestion-option"
    ) as HTMLElement;
    expect(firstDatePreset.children).toHaveLength(2);
    expect(firstDatePreset.children[0]?.tagName).toBe("SPAN");
    expect(firstDatePreset.children[1]?.tagName).toBe("SPAN");

    const weekPreset = Array.from(
      view.contentEl.querySelectorAll(".reverysky-map-date-suggestion-option")
    ).find((el) => el.textContent?.includes("date:>=2026-01-24")) as HTMLElement | undefined;
    expect(weekPreset).toBeDefined();
    weekPreset?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(searchInput.value).toBe("date:>=2026-01-24");
    expect(suggestions.style.display).toBe("none");

    searchInput.dispatchEvent(new Event("click"));
    expect(suggestions.style.display).toBe("block");
    expect(suggestions.textContent).toContain("Date presets");
    expect(suggestions.textContent).not.toContain("Search settings");
  });

  it("builds one-month preset with end-of-month clamping", async () => {
    vi.useFakeTimers();

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    payload.notes[0].date = "2026-03-01T00:00:00.000Z";
    payload.notes[1].date = "2026-03-15T00:00:00.000Z";
    payload.notes[2].date = "2026-03-31T00:00:00.000Z";
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: vi.fn().mockReturnValue(payload) as (app: never) => GraphPayload,
        notify: vi.fn(),
        now: () => Date.UTC(2026, 2, 31, 12, 0, 0)
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

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    searchInput.dispatchEvent(new Event("focus"));

    const dateOption = Array.from(
      view.contentEl.querySelectorAll(".reverysky-map-filter-suggestion-option")
    ).find((el) => el.textContent?.includes("date:")) as HTMLElement | undefined;
    expect(dateOption).toBeDefined();
    dateOption?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    const suggestions = view.contentEl.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
    expect(suggestions.textContent).toContain("date:>=2026-02-28");
    expect(suggestions.textContent).not.toContain("date:>=2026-03-03");
  });

  it("keeps second-level suggestions bound to clicked operator in mixed query", async () => {
    vi.useFakeTimers();

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    payload.notes[0].date = "2026-04-10T00:00:00.000Z";
    payload.notes[1].date = "2026-04-11T00:00:00.000Z";
    payload.notes[2].date = "2026-04-12T00:00:00.000Z";
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: vi.fn().mockReturnValue(payload) as (app: never) => GraphPayload,
        notify: vi.fn(),
        now: () => Date.UTC(2026, 3, 15, 12, 0, 0)
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

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    searchInput.value = 'date:>2026-04-01 path:"Демо/Плагин тесты"';
    searchInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(250);

    searchInput.dispatchEvent(new Event("click"));
    const suggestions = view.contentEl.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
    expect(suggestions.textContent).toContain("Folders");

    searchInput.value = `${searchInput.value} `;
    searchInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(250);
    searchInput.dispatchEvent(new Event("click"));
    expect(suggestions.textContent).toContain("Search settings");

    const dateOption = Array.from(
      view.contentEl.querySelectorAll(".reverysky-map-filter-suggestion-option")
    ).find((el) => el.textContent?.includes("date:")) as HTMLElement | undefined;
    expect(dateOption).toBeDefined();
    dateOption?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(suggestions.textContent).toContain("Date presets");
    expect(suggestions.textContent).not.toContain("Folders");

    searchInput.dispatchEvent(new Event("focus"));
    expect(suggestions.textContent).toContain("Search settings");
    expect(suggestions.textContent).not.toContain("Date presets");
  });

  it("reopens tag suggestions when tag operator is already active in the input", async () => {
    vi.useFakeTimers();

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    const view = new MapView(
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

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    searchInput.value = "tag:#wo";
    searchInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(250);

    searchInput.dispatchEvent(new Event("click"));
    const suggestions = view.contentEl.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
    expect(suggestions.textContent).toContain("Tags");
    expect(suggestions.textContent).toContain("#work/subtag");
    expect(suggestions.textContent).not.toContain("Search settings");
  });

  it("filters tag suggestions against the active trailing tag term in mixed query", async () => {
    vi.useFakeTimers();

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    const view = new MapView(
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

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    searchInput.value = "path:Projects tag:#wo";
    searchInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(250);

    searchInput.dispatchEvent(new Event("click"));
    const suggestions = view.contentEl.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
    expect(searchInput.value).toBe("path:Projects tag:#wo");
    expect(suggestions.textContent).toContain("Tags");
    expect(suggestions.textContent).toContain("#work/subtag");
    expect(suggestions.textContent).not.toContain("#archive");
    expect(suggestions.textContent).not.toContain("#daily");
  });

  it("keeps base filter-type suggestions when query has trailing space", async () => {
    vi.useFakeTimers();

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    payload.notes[0].date = "2026-04-10T00:00:00.000Z";
    payload.notes[1].date = "2026-04-11T00:00:00.000Z";
    payload.notes[2].date = "2026-04-12T00:00:00.000Z";
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: vi.fn().mockReturnValue(payload) as (app: never) => GraphPayload,
        notify: vi.fn(),
        now: () => Date.UTC(2026, 3, 15, 12, 0, 0)
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

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    searchInput.value = "date:>2026-04-01";
    searchInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(250);

    searchInput.dispatchEvent(new Event("click"));
    let suggestions = view.contentEl.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
    expect(suggestions.textContent).toContain("Date presets");
    expect(suggestions.textContent).not.toContain("Search settings");

    searchInput.value = "date:>2026-04-01 ";
    searchInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(250);
    searchInput.dispatchEvent(new Event("click"));

    suggestions = view.contentEl.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
    expect(suggestions.textContent).toContain("Search settings");
    expect(suggestions.textContent).not.toContain("Date presets");
  });

  it("applies date filter query from the same cached source graph", async () => {
    vi.useFakeTimers();

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    payload.notes[0].date = "2026-01-01T00:00:00.000Z";
    payload.notes[1].date = "2026-01-15T00:00:00.000Z";
    payload.notes[2].date = "2026-02-01T00:00:00.000Z";
    const buildGraph = vi.fn().mockReturnValue(payload);
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: buildGraph as (app: never) => GraphPayload,
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

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(1);

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    searchInput.value = "date:>2026-01-01 date:<2026-02-01";
    searchInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(2);
    const filteredPayload = bridge.sendGraphSet.mock.calls[1]?.[0] as GraphPayload;
    expect(filteredPayload.notes.map((note) => note.id)).toEqual(["project"]);
  });

  it("restores showTags state and keeps tag hiding for date queries from cached source graph", async () => {
    vi.useFakeTimers();

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    payload.notes[0].date = "2026-01-01T00:00:00.000Z";
    payload.notes[1].date = "2026-01-15T00:00:00.000Z";
    payload.notes[2].date = "2026-02-01T00:00:00.000Z";
    payload.notes[0].tags = ["daily"];
    payload.notes[1].tags = ["project"];
    payload.notes[2].tags = ["archive"];
    const buildGraph = vi.fn().mockReturnValue(payload);

    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: buildGraph as (app: never) => GraphPayload,
        notify: vi.fn(),
        now: () => 1700000000000
      }
    );

    await view.setState({
      pathFilterQuery: "date:>2026-01-01 date:<2026-02-01",
      showTags: false
    });

    await view.onOpen();
    const iframe = view.contentEl.querySelector("iframe");
    Object.defineProperty(iframe!, "contentWindow", {
      value: { postMessage: vi.fn() } as unknown as Window,
      configurable: true
    });
    iframe!.dispatchEvent(new Event("load"));
    callbacks.onReady?.();

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(1);
    const restoredPayload = bridge.sendGraphSet.mock.calls[0]?.[0] as GraphPayload;
    expect(restoredPayload.notes.map((note) => note.id)).toEqual(["project"]);
    expect(restoredPayload.notes.every((note) => note.tags.length === 0)).toBe(true);

    const tagsToggle = view.contentEl.querySelector(
      ".reverysky-map-tags-toggle"
    ) as HTMLButtonElement;
    expect(tagsToggle.getAttribute("aria-checked")).toBe("false");

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    searchInput.value = "date:>=2026-01-01 date:<2026-02-01";
    searchInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(2);
    const updatedPayload = bridge.sendGraphSet.mock.calls[1]?.[0] as GraphPayload;
    expect(updatedPayload.notes.map((note) => note.id)).toEqual(["daily", "project"]);
    expect(updatedPayload.notes.every((note) => note.tags.length === 0)).toBe(true);
  });

  it("restores showTags state and keeps tag filtering from cached source graph", async () => {
    vi.useFakeTimers();

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    const buildGraph = vi.fn().mockReturnValue(payload);
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: buildGraph as (app: never) => GraphPayload,
        notify: vi.fn(),
        now: () => 1700000000000
      }
    );

    await view.setState({
      pathFilterQuery: "tag:#project",
      showTags: false
    });

    await view.onOpen();
    const iframe = view.contentEl.querySelector("iframe");
    Object.defineProperty(iframe!, "contentWindow", {
      value: { postMessage: vi.fn() } as unknown as Window,
      configurable: true
    });
    iframe!.dispatchEvent(new Event("load"));
    callbacks.onReady?.();

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(1);
    const restoredPayload = bridge.sendGraphSet.mock.calls[0]?.[0] as GraphPayload;
    expect(restoredPayload.notes.map((note) => note.id)).toEqual(["project"]);
    expect(restoredPayload.notes.every((note) => note.tags.length === 0)).toBe(true);

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    expect(searchInput.value).toBe("tag:#project");

    const tagsToggle = view.contentEl.querySelector(
      ".reverysky-map-tags-toggle"
    ) as HTMLButtonElement;
    expect(tagsToggle.getAttribute("aria-checked")).toBe("false");

    searchInput.value = "tag:#daily";
    searchInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(2);
    const updatedPayload = bridge.sendGraphSet.mock.calls[1]?.[0] as GraphPayload;
    expect(updatedPayload.notes.map((note) => note.id)).toEqual(["daily"]);
    expect(updatedPayload.notes.every((note) => note.tags.length === 0)).toBe(true);
  });

  it("applies unquoted folder term for simple path suggestion", async () => {
    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    const view = new MapView(
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

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    searchInput.dispatchEvent(new Event("focus"));
    const pathOption = view.contentEl.querySelector(
      ".reverysky-map-filter-suggestion-option"
    ) as HTMLElement;
    pathOption.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(
      view.contentEl.querySelectorAll(".reverysky-map-folder-suggestion-option").length
    ).toBeGreaterThan(0);

    const notesOption = Array.from(
      view.contentEl.querySelectorAll(".reverysky-map-folder-suggestion-option")
    ).find((el) => el.textContent === "Notes") as HTMLButtonElement | undefined;
    expect(notesOption).toBeDefined();
    notesOption?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(searchInput.value).toBe("path:Notes");
  });

  it("hides path filter suggestions after input blur delay", async () => {
    vi.useFakeTimers();

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    const view = new MapView(
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

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    const suggestions = view.contentEl.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
    searchInput.dispatchEvent(new Event("focus"));
    expect(suggestions.style.display).toBe("block");

    searchInput.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(120);
    expect(suggestions.style.display).toBe("none");
  });

  it("does not emit broken payload when path query is invalid", async () => {
    vi.useFakeTimers();

    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    const view = new MapView(
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
    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(1);

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    searchInput.value = "path:\"daily";
    searchInput.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(250);

    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(1);
  });

  it("restores path filter query from view state", async () => {
    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: vi.fn().mockReturnValue(payload) as (app: never) => GraphPayload,
        notify: vi.fn(),
        now: () => 1700000000000
      }
    );

    await view.setState({
      pathFilterQuery: "path:archive"
    });
    expect(view.getState()).toMatchObject({
      pathFilterQuery: "path:archive"
    });

    await view.onOpen();
    const iframe = view.contentEl.querySelector("iframe");
    Object.defineProperty(iframe!, "contentWindow", {
      value: { postMessage: vi.fn() } as unknown as Window,
      configurable: true
    });
    iframe!.dispatchEvent(new Event("load"));
    callbacks.onReady?.();

    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(1);
    const outgoingPayload = bridge.sendGraphSet.mock.calls[0]?.[0] as GraphPayload;
    expect(outgoingPayload.notes.map((note) => note.id)).toEqual(["archive"]);
    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    expect(searchInput.value).toBe("path:archive");
  });

  it("restores engine preference from view state", async () => {
    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: vi.fn().mockReturnValue(payload) as (app: never) => GraphPayload,
        notify: vi.fn(),
        now: () => 1700000000000
      }
    );

    await view.setState({
      enginePreference: "static25d"
    });
    expect(view.getState()).toMatchObject({
      enginePreference: "static25d"
    });

    await view.onOpen();
    const iframe = view.contentEl.querySelector("iframe");
    Object.defineProperty(iframe!, "contentWindow", {
      value: { postMessage: vi.fn() } as unknown as Window,
      configurable: true
    });
    iframe!.dispatchEvent(new Event("load"));
    callbacks.onReady?.();

    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(1);
    const outgoingPayload = bridge.sendGraphSet.mock.calls[0]?.[0] as GraphPayload;
    expect(outgoingPayload.enginePreference).toBe("static25d");
    const engineSelect = view.contentEl.querySelector(
      ".reverysky-map-engine-select"
    ) as HTMLSelectElement;
    expect(engineSelect.value).toBe("static25d");
  });

  it("restores tag filter query from view state", async () => {
    const app = {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" }),
        getAbstractFileByPath: vi.fn()
      },
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
      }),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };

    const payload = makePathPayload();
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: vi.fn().mockReturnValue(payload) as (app: never) => GraphPayload,
        notify: vi.fn(),
        now: () => 1700000000000
      }
    );

    await view.setState({
      pathFilterQuery: "tag:#project"
    });
    expect(view.getState()).toMatchObject({
      pathFilterQuery: "tag:#project"
    });

    await view.onOpen();
    const iframe = view.contentEl.querySelector("iframe");
    Object.defineProperty(iframe!, "contentWindow", {
      value: { postMessage: vi.fn() } as unknown as Window,
      configurable: true
    });
    iframe!.dispatchEvent(new Event("load"));
    callbacks.onReady?.();

    expect(bridge.sendGraphSet).toHaveBeenCalledTimes(1);
    const outgoingPayload = bridge.sendGraphSet.mock.calls[0]?.[0] as GraphPayload;
    expect(outgoingPayload.notes.map((note) => note.id)).toEqual(["project"]);
    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    expect(searchInput.value).toBe("tag:#project");
  });

  it("registers refresh subscriptions only once across reopen cycles", async () => {
    const metadataCacheOn = vi.fn().mockReturnValue({ id: "metadata-event-ref" });
    const vaultOn = vi.fn().mockReturnValue({ id: "vault-event-ref" });

    const app = {
      metadataCache: {
        on: metadataCacheOn
      },
      vault: {
        on: vaultOn,
        getAbstractFileByPath: vi.fn()
      },
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

    const bridge = {
      attach: vi.fn(),
      detach: vi.fn(),
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
    };
    const view = new MapView(
      { app } as never,
      plugin as never,
      {
        createBridge: () => bridge,
        buildGraph: vi.fn().mockReturnValue(makePayload()) as (app: never) => GraphPayload,
        notify: vi.fn(),
        now: () => 1700000000000
      }
    );

    await view.onOpen();
    await view.onClose();
    await view.onOpen();

    expect(metadataCacheOn).toHaveBeenCalledTimes(2);
    expect(vaultOn).toHaveBeenCalledTimes(3);
  });
});
