import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphPayload } from "../../src/bridge/BridgeTypes";
import { MapSession } from "../../src/view/MapSession";

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
    mapLayout: "auto"
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
    mapLayout: "auto"
  };
}

function createSessionForStateTests(options?: {
  sendGraph?: ReturnType<typeof vi.fn>;
}) {
  return new MapSession({
    app: {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
      },
      workspace: {
        activeLeaf: null,
        getLeavesOfType: vi.fn().mockReturnValue([]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    } as never,
    buildGraph: vi.fn().mockReturnValue(makePayload()) as (app: never) => GraphPayload,
    now: () => 1700000000000,
    sendGraph: options?.sendGraph ?? vi.fn(),
    sendFocus: vi.fn()
  });
}

describe("MapSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes and restores render scale state", async () => {
    const session = createSessionForStateTests();
    expect(session.getState()).toMatchObject({ renderScale: 1 });
    expect(session.getFilterUiState()).toMatchObject({
      renderScale: 1,
      renderScaleRestartRequired: false
    });

    await session.setState({ renderScale: 1.24 });
    expect(session.getState()).toMatchObject({ renderScale: 1.2 });

    await session.setState({ renderScale: 0.5 });
    expect(session.getState()).toMatchObject({ renderScale: 0.5 });

    await session.setState({ renderScale: 1.5 });
    expect(session.getState()).toMatchObject({ renderScale: 1.5 });

    await session.setState({ renderScale: 2 });
    expect(session.getState()).toMatchObject({ renderScale: 1 });

    await session.setState({ renderScale: "sharp" });
    expect(session.getState()).toMatchObject({ renderScale: 1 });
  });

  it("tracks render scale restart state without re-emitting graph data", async () => {
    const sendGraph = vi.fn();
    const session = createSessionForStateTests({ sendGraph });
    session.start(() => undefined);

    session.setRenderScale(1.2);

    expect(sendGraph).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ renderScale: 1.2 });
    expect(session.getFilterUiState()).toMatchObject({
      renderScale: 1.2,
      renderScaleRestartRequired: true
    });

    session.setRenderScale(1);
    expect(session.getFilterUiState()).toMatchObject({
      renderScale: 1,
      renderScaleRestartRequired: false
    });
  });

  it("does not refresh when only frontmatter date changes and tags/links stay stable", () => {
    vi.useFakeTimers();

    const metadataCallbacks: {
      changed?: (file: { path?: string }, data: string, cache: { links?: Array<{ link: string }>; tags?: Array<{ tag: string }>; frontmatter?: unknown }) => void;
      resolved?: () => void;
    } = {};

    const app = {
      metadataCache: {
        on: vi.fn((name: "changed" | "resolved", callback: (...args: never[]) => void) => {
          if (name === "changed") {
            metadataCallbacks.changed = callback as typeof metadataCallbacks.changed;
          } else {
            metadataCallbacks.resolved = callback as () => void;
          }
          return { id: `metadata-${name}` };
        })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
      },
      workspace: {
        activeLeaf: null,
        getLeavesOfType: vi.fn().mockReturnValue([]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    };

    const buildGraph = vi.fn().mockReturnValue(makePayload());
    const sendGraph = vi.fn();
    const session = new MapSession({
      app: app as never,
      buildGraph: buildGraph as (app: never) => GraphPayload,
      now: () => 1700000000000,
      sendGraph,
      sendFocus: vi.fn()
    });

    session.start(() => undefined);
    session.setBridgeReady(true);
    session.flushOrRefresh();
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
        frontmatter: { date: "2026-02-01" }
      }
    );
    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(2);
    expect(sendGraph).toHaveBeenCalledTimes(2);
  });

  it("queues latest graph before bridge ready and flushes it on ready", () => {
    vi.useFakeTimers();

    const metadataCallbacks: {
      changed?: (file: { path?: string }, data: string, cache: { links?: Array<{ link: string }>; tags?: Array<{ tag: string }> }) => void;
      resolved?: () => void;
    } = {};

    const app = {
      metadataCache: {
        on: vi.fn((name: "changed" | "resolved", callback: (...args: never[]) => void) => {
          if (name === "changed") {
            metadataCallbacks.changed = callback as typeof metadataCallbacks.changed;
          } else {
            metadataCallbacks.resolved = callback as () => void;
          }
          return { id: `metadata-${name}` };
        })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
      },
      workspace: {
        activeLeaf: null,
        getLeavesOfType: vi.fn().mockReturnValue([]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    };

    const queuedPayload = makePayload();
    queuedPayload.notes[0].id = "queued";
    const buildGraph = vi.fn().mockReturnValue(queuedPayload);
    const sendGraph = vi.fn();
    const session = new MapSession({
      app: app as never,
      buildGraph: buildGraph as (app: never) => GraphPayload,
      now: () => 1700000000000,
      sendGraph,
      sendFocus: vi.fn()
    });

    session.start(() => undefined);

    metadataCallbacks.changed?.(
      { path: "Folder/Note.md" },
      "content changed",
      { links: [{ link: "RefA" }], tags: [{ tag: "#tag-a" }] }
    );
    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledTimes(0);

    session.setBridgeReady(true);
    session.flushOrRefresh();

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledWith(queuedPayload);
  });

  it("keeps graph payload focus-free and sends live note focus for active leaf changes", () => {
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
            vaultCallbacks.create = callback as typeof vaultCallbacks.create;
          }
          return { id: `vault-${name}` };
        })
      },
      workspace: {
        activeLeaf: activeLeafA,
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

    const payload = makePayload();
    payload.notes = [
      { id: "a", path: "Folder/A.md", title: "A", tags: [], date: "2026-01-01T00:00:00.000Z", size: 10 },
      { id: "b", path: "Folder/B.md", title: "B", tags: [], date: "2026-01-02T00:00:00.000Z", size: 20 },
      { id: "new", path: "Folder/New.md", title: "New", tags: [], date: "2026-01-03T00:00:00.000Z", size: 30 }
    ];
    payload.vault.noteCount = payload.notes.length;

    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: app as never,
      buildGraph: vi.fn().mockReturnValue(payload) as (app: never) => GraphPayload,
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    session.start(() => undefined);
    session.setBridgeReady(true);
    session.flushOrRefresh();

    expect(sendFocus).not.toHaveBeenCalled();
    const initialPayload = sendGraph.mock.calls[0]?.[0] as GraphPayload;
    expect(initialPayload).toEqual({
      ...payload,
      mapLayout: "auto"
    });

    vaultCallbacks.create?.({ path: "Folder/New.md" });
    onActiveLeafChange?.(activeLeafB);

    expect(sendFocus).toHaveBeenLastCalledWith({
      id: "b",
      path: "Folder/B.md"
    });

    vi.advanceTimersByTime(250);

    const refreshedPayload = sendGraph.mock.calls[1]?.[0] as GraphPayload;
    expect(refreshedPayload).toEqual({
      ...payload,
      mapLayout: "auto"
    });
  });

  it("preserves focus on active note after rename commit", () => {
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
            vaultCallbacks.rename = callback as typeof vaultCallbacks.rename;
          }
          return { id: `vault-${name}` };
        })
      },
      workspace: {
        activeLeaf,
        getLeavesOfType: vi.fn().mockReturnValue([activeLeaf]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    };

    const payload = makePayload();
    payload.notes = [
      { id: "new", path: "Folder/New.md", title: "New", tags: [], date: "2026-01-03T00:00:00.000Z", size: 30 }
    ];
    payload.vault.noteCount = payload.notes.length;

    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: app as never,
      buildGraph: vi.fn().mockReturnValue(payload) as (app: never) => GraphPayload,
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    session.start(() => undefined);
    session.setBridgeReady(true);

    vaultCallbacks.rename?.({ path: "Folder/New.md" }, "Folder/Old.md");
    vi.advanceTimersByTime(250);

    expect(sendFocus).not.toHaveBeenCalled();
    const sentPayload = sendGraph.mock.calls[0]?.[0] as GraphPayload;
    expect(sentPayload).toEqual({
      ...payload,
      mapLayout: "auto"
    });
  });

  it("restores state and reuses cached source graph for filtered re-emit", async () => {
    vi.useFakeTimers();

    const buildGraph = vi.fn().mockReturnValue(makePathPayload());
    const sendGraph = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
        },
        vault: {
          on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
        },
        workspace: {
          activeLeaf: null,
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: buildGraph as (app: never) => GraphPayload,
      now: () => 1700000000000,
      sendGraph,
      sendFocus: vi.fn()
    });

    await session.setState({
      pathFilterQuery: "tag:#project",
      showTags: false,
      mapLayout: "dates"
    });

    session.start(() => undefined);
    session.setBridgeReady(true);
    session.flushOrRefresh();

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledTimes(1);
    const restoredPayload = sendGraph.mock.calls[0]?.[0] as GraphPayload;
    expect(restoredPayload.notes.map((note) => note.id)).toEqual(["project"]);
    expect(restoredPayload.notes[0]?.tags).toEqual([]);
    expect(restoredPayload.mapLayout).toBe("dates");

    session.setFilterQuery("path:archive");
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledTimes(2);
    const updatedPayload = sendGraph.mock.calls[1]?.[0] as GraphPayload;
    expect(updatedPayload.notes.map((note) => note.id)).toEqual(["archive"]);
  });

  it("registers refresh subscriptions only once across reopen cycles", () => {
    const metadataCacheOn = vi.fn().mockReturnValue({ id: "metadata-event-ref" });
    const vaultOn = vi.fn().mockReturnValue({ id: "vault-event-ref" });

    const session = new MapSession({
      app: {
        metadataCache: {
          on: metadataCacheOn
        },
        vault: {
          on: vaultOn
        },
        workspace: {
          activeLeaf: null,
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: vi.fn().mockReturnValue(makePayload()) as (app: never) => GraphPayload,
      now: () => 1700000000000,
      sendGraph: vi.fn(),
      sendFocus: vi.fn()
    });

    session.start(() => undefined);
    session.stop();
    session.start(() => undefined);

    expect(metadataCacheOn).toHaveBeenCalledTimes(2);
    expect(vaultOn).toHaveBeenCalledTimes(3);
  });
});
