import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
        date: "2026-01-01T00:00:00.000Z",
        size: 64
      }
    ],
    links: []
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
        tags: [],
        size: 20
      },
      {
        id: "project",
        path: "Projects/ReverySky/Spec.md",
        title: "Spec",
        tags: [],
        size: 21
      },
      {
        id: "archive",
        path: "Archive/Old.md",
        title: "Old",
        tags: [],
        size: 22
      }
    ],
    links: [
      { sourceId: "daily", targetId: "project", kind: "resolved" },
      { sourceId: "project", targetId: "archive", kind: "resolved" }
    ]
  };
}

describe("ReverySkyMapView bridge integration", () => {
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
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
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
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
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
      sendGraphSet: vi.fn(),
      sendNoteFocus: vi.fn()
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
    const view = new ReverySkyMapView(
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
    const view = new ReverySkyMapView(
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
    const view = new ReverySkyMapView(
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
    const view = new ReverySkyMapView(
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

    const view = new ReverySkyMapView(
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
    const view = new ReverySkyMapView(
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

    const searchInput = view.contentEl.querySelector("input.search-input") as HTMLInputElement;
    const suggestions = view.contentEl.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
    expect(suggestions).not.toBeNull();
    expect(suggestions.style.display).toBe("none");

    searchInput.dispatchEvent(new Event("focus"));
    expect(suggestions.style.display).toBe("block");
    expect(suggestions.textContent).toContain("Search settings");
    expect(suggestions.textContent).toContain("path: match in file path");

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
    const view = new ReverySkyMapView(
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
