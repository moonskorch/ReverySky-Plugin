import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { GraphPayload, NoteFocusPayload } from "../../src/bridge/BridgeTypes";
import { makeStableNoteId } from "../../src/graph/VaultGraphBuilder";
import { MapSession } from "../../src/view/MapSession";
import { callMaybe, makeBuildGraphMock, makeVoidCallback } from "./testUtils";

function makeTestTFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

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

function makeEgoPayload(): GraphPayload {
  return {
    graphVersion: "0.0.1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    vault: { noteCount: 5 },
    notes: [
      {
        id: "daily",
        path: "Notes/Daily/2026-01-01.md",
        title: "Daily",
        tags: ["daily"],
        size: 20
      },
      {
        id: "project",
        path: "Projects/ReverySky/Spec.md",
        title: "Spec",
        tags: ["project"],
        size: 21
      },
      {
        id: "archive",
        path: "Archive/Old.md",
        title: "Old",
        tags: ["archive"],
        size: 22
      },
      {
        id: "neighbor-note",
        path: "Projects/ReverySky/Neighbor.md",
        title: "Neighbor",
        tags: ["project"],
        size: 23
      },
      {
        id: "isolated",
        path: "Inbox/Isolated.md",
        title: "Isolated",
        tags: ["inbox"],
        size: 24
      }
    ],
    links: [
      { sourceId: "daily", targetId: "project", kind: "resolved" },
      { sourceId: "project", targetId: "archive", kind: "resolved" },
      { sourceId: "archive", targetId: "neighbor-note", kind: "resolved" }
    ],
    mapLayout: "auto"
  };
}

function makeDepthPayload(): GraphPayload {
  return {
    graphVersion: "0.0.1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    vault: { noteCount: 7 },
    notes: [
      {
        id: "center",
        path: "Depth/Center.md",
        title: "Center",
        tags: ["center"],
        size: 20
      },
      {
        id: "left",
        path: "Depth/Left.md",
        title: "Left",
        tags: ["left"],
        size: 21
      },
      {
        id: "right",
        path: "Depth/Right.md",
        title: "Right",
        tags: ["right"],
        size: 22
      },
      {
        id: "outer-left",
        path: "Depth/OuterLeft.md",
        title: "Outer Left",
        tags: ["outer-left"],
        size: 23
      },
      {
        id: "outer-right",
        path: "Depth/OuterRight.md",
        title: "Outer Right",
        tags: ["outer-right"],
        size: 24
      },
      {
        id: "far",
        path: "Depth/Far.md",
        title: "Far",
        tags: ["far"],
        size: 25
      },
      {
        id: "isolated",
        path: "Depth/Isolated.md",
        title: "Isolated",
        tags: ["isolated"],
        size: 26
      }
    ],
    links: [
      { sourceId: "center", targetId: "left", kind: "resolved" },
      { sourceId: "right", targetId: "center", kind: "resolved" },
      { sourceId: "left", targetId: "outer-left", kind: "resolved" },
      { sourceId: "outer-right", targetId: "right", kind: "resolved" },
      { sourceId: "outer-left", targetId: "outer-right", kind: "resolved" },
      { sourceId: "outer-left", targetId: "far", kind: "resolved" }
    ],
    mapLayout: "auto"
  };
}

function withStableNoteIds(payload: GraphPayload): GraphPayload {
  const stableIdByOriginalId = new Map(
    payload.notes.map((note) => [note.id, makeStableNoteId(note.path)])
  );
  return {
    ...payload,
    notes: payload.notes.map((note) => ({
      ...note,
      id: stableIdByOriginalId.get(note.id) ?? note.id
    })),
    links: payload.links.map((link) => ({
      ...link,
      sourceId: stableIdByOriginalId.get(link.sourceId) ?? link.sourceId,
      targetId: stableIdByOriginalId.get(link.targetId) ?? link.targetId
    }))
  };
}

function createSessionForStateTests(options?: {
  sendGraph?: (payload: GraphPayload) => void;
  sendRuntimeSettings?: (payload: { frameRateMode: "auto" | "fps60" | "fps30" | "fps24" }) => void;
  onStateChanged?: (state: Record<string, unknown>) => void;
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
    buildGraph: makeBuildGraphMock(makePayload()),
    now: () => 1700000000000,
    sendGraph: options?.sendGraph ?? makeVoidCallback<[GraphPayload]>(),
    sendFocus: makeVoidCallback<[NoteFocusPayload]>(),
    sendRuntimeSettings: options?.sendRuntimeSettings,
    onStateChanged: options?.onStateChanged
  });
}

function createEgoGraphSession(
  payload: GraphPayload,
  options?: {
    sendGraph?: (payload: GraphPayload) => void;
    sendFocus?: (payload: NoteFocusPayload) => void;
  }
): MapSession {
  return new MapSession({
    app: {
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue(null),
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        getAbstractFileByPath: vi.fn((path: string) => makeTestTFile(path)),
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
      },
      workspace: {
        activeLeaf: null,
        getLeavesOfType: vi.fn().mockReturnValue([]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    } as never,
    buildGraph: makeBuildGraphMock(payload),
    now: () => 1700000000000,
    sendGraph: options?.sendGraph ?? makeVoidCallback<[GraphPayload]>(),
    sendFocus: options?.sendFocus ?? makeVoidCallback<[NoteFocusPayload]>()
  });
}

describe("MapSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes and restores render scale, frame-rate mode, and ego state", async () => {
    const session = createSessionForStateTests();
    expect(session.getState()).toMatchObject({
      renderScale: 1,
      frameRateMode: "auto",
      egoEnabled: false,
      egoDepth: 1,
      egoNeighborLinksEnabled: false
    });
    expect(session.getFilterUiState()).toMatchObject({
      renderScale: 1,
      renderScaleRestartRequired: false,
      frameRateMode: "auto",
      egoEnabled: false,
      egoDepth: 1,
      egoNeighborLinksEnabled: false
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

    await session.setState({ frameRateMode: "fps60" });
    expect(session.getState()).toMatchObject({ frameRateMode: "fps60" });

    await session.setState({ frameRateMode: "turbo" });
    expect(session.getState()).toMatchObject({ frameRateMode: "auto" });

    await session.setState({
      egoEnabled: true,
      egoDepth: 4,
      egoNeighborLinksEnabled: true
    });
    expect(session.getState()).toMatchObject({
      egoEnabled: true,
      egoDepth: 4,
      egoNeighborLinksEnabled: true
    });

    await session.setState({
      egoEnabled: "yes",
      egoDepth: 6,
      egoNeighborLinksEnabled: "yes"
    });
    expect(session.getState()).toMatchObject({
      egoEnabled: false,
      egoDepth: 1,
      egoNeighborLinksEnabled: false
    });
  });

  it("ignores legacy local state keys", async () => {
    const session = createSessionForStateTests();

    await session.setState({
      localEnabled: true,
      localDepth: 4,
      localNeighborLinksEnabled: true
    });

    expect(session.getState()).toMatchObject({
      egoEnabled: false,
      egoDepth: 1,
      egoNeighborLinksEnabled: false
    });
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

  it("reports user state changes without reporting restored state", async () => {
    vi.useFakeTimers();
    const onStateChanged = vi.fn();
    const session = createSessionForStateTests({ onStateChanged });
    session.start(() => undefined);

    await session.setState({
      filterQuery: "tag:#restored",
      showTags: false,
      mapLayout: "dates",
      renderScale: 1.2
    });
    expect(onStateChanged).not.toHaveBeenCalled();

    session.setFilterQuery("tag:#project");

    expect(onStateChanged).toHaveBeenLastCalledWith({
      filterQuery: "tag:#project",
      showTags: false,
      mapLayout: "dates",
      renderScale: 1.2,
      frameRateMode: "auto",
      egoEnabled: false,
      egoDepth: 1,
      egoNeighborLinksEnabled: false
    }, { persist: false });

    vi.runOnlyPendingTimers();

    expect(onStateChanged).toHaveBeenLastCalledWith({
      filterQuery: "tag:#project",
      showTags: false,
      mapLayout: "dates",
      renderScale: 1.2,
      frameRateMode: "auto",
      egoEnabled: false,
      egoDepth: 1,
      egoNeighborLinksEnabled: false
    }, undefined);
  });

  it("persists ego settings when they change", () => {
    const onStateChanged = vi.fn();
    const session = createSessionForStateTests({ onStateChanged });

    session.setEgoEnabled(true);
    expect(onStateChanged).toHaveBeenLastCalledWith({
      filterQuery: "",
      showTags: true,
      mapLayout: "auto",
      renderScale: 1,
      frameRateMode: "auto",
      egoEnabled: true,
      egoDepth: 1,
      egoNeighborLinksEnabled: false
    }, undefined);

    session.setEgoDepth("5");
    expect(onStateChanged).toHaveBeenLastCalledWith({
      filterQuery: "",
      showTags: true,
      mapLayout: "auto",
      renderScale: 1,
      frameRateMode: "auto",
      egoEnabled: true,
      egoDepth: 5,
      egoNeighborLinksEnabled: false
    }, undefined);

    session.setEgoNeighborLinksEnabled(true);
    expect(onStateChanged).toHaveBeenLastCalledWith({
      filterQuery: "",
      showTags: true,
      mapLayout: "auto",
      renderScale: 1,
      frameRateMode: "auto",
      egoEnabled: true,
      egoDepth: 5,
      egoNeighborLinksEnabled: true
    }, undefined);
  });

  it("does not re-emit graph when the parsed filter stays unchanged", () => {
    vi.useFakeTimers();

    const sendGraph = vi.fn();
    const session = createSessionForStateTests({ sendGraph });
    session.start(() => undefined);
    session.handleRuntimeReady();

    expect(sendGraph).toHaveBeenCalledTimes(1);

    session.setFilterQuery("tag:#PROJECT");
    vi.advanceTimersByTime(500);

    expect(sendGraph).toHaveBeenCalledTimes(2);

    session.setFilterQuery(" tag:#project\u00A0");
    vi.advanceTimersByTime(500);

    expect(session.getState()).toMatchObject({ filterQuery: " tag:#project\u00A0" });
    expect(sendGraph).toHaveBeenCalledTimes(2);
  });

  it("sends the parsed filter when a formatting-only edit extends debounce", () => {
    vi.useFakeTimers();

    const sendGraph = vi.fn();
    const session = createSessionForStateTests({ sendGraph });
    session.start(() => undefined);
    session.handleRuntimeReady();

    session.setFilterQuery("path:Note");
    session.setFilterQuery("path:Note ");
    vi.advanceTimersByTime(500);

    expect(sendGraph).toHaveBeenCalledTimes(2);
  });

  it("ignores exact no-op filter commits", () => {
    vi.useFakeTimers();

    const sendGraph = vi.fn();
    const onStateChanged = vi.fn();
    const session = createSessionForStateTests({ sendGraph, onStateChanged });
    session.start(() => undefined);
    session.handleRuntimeReady();
    sendGraph.mockClear();
    onStateChanged.mockClear();

    session.setFilterQuery("");
    vi.runOnlyPendingTimers();

    expect(onStateChanged).not.toHaveBeenCalled();
    expect(sendGraph).not.toHaveBeenCalled();
  });

  it("sends frame-rate mode settings without re-emitting graph data", () => {
    const sendGraph = vi.fn();
    const sendRuntimeSettings = vi.fn();
    const session = createSessionForStateTests({ sendGraph, sendRuntimeSettings });
    session.start(() => undefined);

    session.setFrameRateMode("fps60");

    expect(session.getState()).toMatchObject({ frameRateMode: "fps60" });
    expect(sendRuntimeSettings).not.toHaveBeenCalled();
    expect(sendGraph).not.toHaveBeenCalled();

    session.handleRuntimeReady();

    expect(sendRuntimeSettings).toHaveBeenCalledWith({ frameRateMode: "fps60" });
    expect(sendGraph).toHaveBeenCalledTimes(1);

    sendRuntimeSettings.mockClear();
    sendGraph.mockClear();
    session.setFrameRateMode("fps24");

    expect(sendRuntimeSettings).toHaveBeenCalledWith({ frameRateMode: "fps24" });
    expect(sendGraph).not.toHaveBeenCalled();
  });

  it("persists render scale only after the slider commits", () => {
    const onStateChanged = vi.fn();
    const session = createSessionForStateTests({ onStateChanged });
    session.start(() => undefined);

    session.setRenderScale(1.2);

    expect(session.getState()).toMatchObject({ renderScale: 1.2 });
    expect(onStateChanged).toHaveBeenLastCalledWith({
      filterQuery: "",
      showTags: true,
      mapLayout: "auto",
      renderScale: 1.2,
      frameRateMode: "auto",
      egoEnabled: false,
      egoDepth: 1,
      egoNeighborLinksEnabled: false
    }, { persist: false });

    session.persistRenderScale();

    expect(onStateChanged).toHaveBeenLastCalledWith({
      filterQuery: "",
      showTags: true,
      mapLayout: "auto",
      renderScale: 1.2,
      frameRateMode: "auto",
      egoEnabled: false,
      egoDepth: 1,
      egoNeighborLinksEnabled: false
    }, undefined);
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

    const buildGraph = makeBuildGraphMock(makePayload());
    const sendGraph = vi.fn();
    const session = new MapSession({
      app: app as never,
      buildGraph,
      now: () => 1700000000000,
      sendGraph,
      sendFocus: vi.fn()
    });

    session.start(() => undefined);
    session.handleRuntimeReady();
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

  it("queues latest graph before bridge ready and sends it on ready", () => {
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
    const buildGraph = makeBuildGraphMock(queuedPayload);
    const sendGraph = vi.fn();
    const session = new MapSession({
      app: app as never,
      buildGraph,
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

    session.handleRuntimeReady();

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledWith(queuedPayload);
  });

  it("waits for metadata resolved instead of rebuilding from the fallback timer", () => {
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

    const buildGraph = makeBuildGraphMock(makePayload());
    const sendGraph = vi.fn();
    const sendStatus = vi.fn();
    const session = new MapSession({
      app: app as never,
      buildGraph,
      now: () => 1700000000000,
      sendGraph,
      sendStatus,
      sendFocus: vi.fn()
    });

    session.start(() => undefined);
    session.handleRuntimeReady();
    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledTimes(1);

    metadataCallbacks.changed?.(
      { path: "Folder/Note.md" },
      "content changed",
      { links: [{ link: "RefA" }], tags: [{ tag: "#tag-a" }] }
    );

    expect(sendStatus).toHaveBeenCalledWith("Updating graph data...");
    vi.advanceTimersByTime(5000);
    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledTimes(1);

    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(2);
    expect(sendGraph).toHaveBeenCalledTimes(2);
  });

  it("primes editor-focus signature before the first plain text edit", () => {
    vi.useFakeTimers();

    const noteFile = makeTestTFile("Folder/Note.md");
    const focusedCache = {
      links: [{ link: "RefA" }],
      tags: [{ tag: "#tag-a" }]
    };
    const metadataCallbacks: {
      changed?: (file: { path?: string }, data: string, cache: { links?: Array<{ link: string }>; tags?: Array<{ tag: string }> }) => void;
      resolved?: () => void;
    } = {};

    const app = {
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue(focusedCache),
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
        getAbstractFileByPath: vi.fn((path: string) => path === noteFile.path ? noteFile : null),
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
      },
      workspace: {
        activeLeaf: null,
        getLeavesOfType: vi.fn().mockReturnValue([]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    };

    const buildGraph = makeBuildGraphMock(makePayload());
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: app as never,
      buildGraph,
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    session.start(() => undefined);
    expect(buildGraph).toHaveBeenCalledTimes(0);
    expect(sendGraph).toHaveBeenCalledTimes(0);

    session.requestFocusFromEditor(noteFile.path);
    metadataCallbacks.changed?.(
      noteFile,
      "plain text changed",
      { links: [{ link: "RefA" }], tags: [{ tag: "#tag-a" }] }
    );
    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);

    expect(app.metadataCache.getFileCache).toHaveBeenCalledWith(noteFile);
    expect(sendFocus).toHaveBeenCalledTimes(0);
    expect(buildGraph).toHaveBeenCalledTimes(0);
    expect(sendGraph).toHaveBeenCalledTimes(0);

    metadataCallbacks.changed?.(
      noteFile,
      "link changed",
      { links: [{ link: "RefA" }, { link: "RefB" }], tags: [{ tag: "#tag-a" }] }
    );
    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledTimes(0);
  });

  it("refreshes the startup graph once when metadata resolves after the first build", () => {
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

    const firstPayload = makePayload();
    firstPayload.notes[0].id = "initial";
    const resolvedPayload = makePayload();
    resolvedPayload.notes[0].id = "resolved";
    const buildGraph = vi.fn()
      .mockReturnValueOnce(firstPayload)
      .mockReturnValue(resolvedPayload);
    const sendGraph = vi.fn();
    const session = new MapSession({
      app: app as never,
      buildGraph,
      now: () => 1700000000000,
      sendGraph,
      sendFocus: vi.fn()
    });

    session.start(() => undefined);
    session.handleRuntimeReady();

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledTimes(1);

    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(2);
    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect(sendGraph.mock.calls[1]?.[0]).toMatchObject({
      notes: [expect.objectContaining({ id: "resolved" })]
    });

    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(2);
    expect(sendGraph).toHaveBeenCalledTimes(2);
  });

  it("ignores metadata resolved before the startup graph is emitted", () => {
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

    const buildGraph = vi.fn().mockReturnValue(makePayload());
    const sendGraph = vi.fn();
    const session = new MapSession({
      app: app as never,
      buildGraph,
      now: () => 1700000000000,
      sendGraph,
      sendFocus: vi.fn()
    });

    session.start(() => undefined);
    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);
    expect(buildGraph).not.toHaveBeenCalled();
    expect(sendGraph).not.toHaveBeenCalled();

    session.handleRuntimeReady();

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledTimes(1);

    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);

    expect(buildGraph).toHaveBeenCalledTimes(2);
    expect(sendGraph).toHaveBeenCalledTimes(2);
  });

  it("keeps an ordinary graph refresh focus-free when no focus event occurred", () => {
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
        },
        vault: {
          on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
        },
        workspace: {
          activeLeaf: {
            view: {
              getViewType: () => "markdown",
              file: { path: "Folder/A.md" }
            }
          },
          getLeavesOfType: vi.fn().mockReturnValue([
            {
              view: {
                getViewType: () => "markdown",
                file: { path: "Folder/A.md" }
              }
            }
          ]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: makeBuildGraphMock(makePayload()),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    session.start(() => undefined);
    session.handleRuntimeReady();
    session.handleRuntimeReady();

    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect(sendFocus).not.toHaveBeenCalled();
  });

  it("sends editor-focus note focus when the matching note exists in the effective graph", () => {
    let currentTime = 1700000000000;
    let onFileOpen: ((file: { path?: string } | null) => void) | null = null;
    const dailyLeaf = {
      view: {
        getViewType: () => "markdown",
        file: { path: "Notes/Daily/2026-01-01.md" }
      }
    };
    const projectLeaf = {
      view: {
        getViewType: () => "markdown",
        file: { path: "Projects/ReverySky/Spec.md" }
      }
    };
    const projectFile = makeTestTFile(projectLeaf.view.file.path);

    const payload = makePathPayload();
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const app = {
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue(null),
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        getAbstractFileByPath: vi.fn((path: string) => path === projectFile.path ? projectFile : null),
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
      },
      workspace: {
        activeLeaf: dailyLeaf,
        getLeavesOfType: vi.fn().mockReturnValue([dailyLeaf]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn((eventName: string, callback: (file: { path?: string } | null) => void) => {
          if (eventName === "file-open") {
            onFileOpen = callback;
          }
          return { id: "event-ref" };
        })
      }
    };
    const session = new MapSession({
      app: app as never,
      buildGraph: makeBuildGraphMock(payload),
      now: () => currentTime,
      sendGraph,
      sendFocus
    });

    session.start(() => undefined);
    session.handleRuntimeReady();

    app.workspace.activeLeaf = projectLeaf;
    session.requestFocusFromEditor(projectLeaf.view.file.path);

    expect(sendGraph).toHaveBeenCalledTimes(1);
    expect(sendFocus).toHaveBeenCalledTimes(1);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId("Projects/ReverySky/Spec.md"),
      path: "Projects/ReverySky/Spec.md"
    });

    callMaybe(onFileOpen, { path: "Notes/Daily/2026-01-01.md" });
    expect(sendFocus).toHaveBeenCalledTimes(2);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId("Notes/Daily/2026-01-01.md"),
      path: "Notes/Daily/2026-01-01.md"
    });
  });

  it("does not send editor focus before the bridge is ready", () => {
    const payload = makePathPayload();
    const projectFile = makeTestTFile("Projects/ReverySky/Spec.md");
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue(null),
          on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
        },
        vault: {
          getAbstractFileByPath: vi.fn((path: string) => path === projectFile.path ? projectFile : null),
          on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
        },
        workspace: {
          activeLeaf: null,
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: makeBuildGraphMock(payload),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    session.start(() => undefined);
    session.requestFocusFromEditor("Projects/ReverySky/Spec.md");

    expect(sendGraph).not.toHaveBeenCalled();
    expect(sendFocus).not.toHaveBeenCalled();
  });

  it("sends startup active note focus after the initial global graph", () => {
    const activeFile = makeTestTFile("Note.md");
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
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
          getActiveFile: vi.fn().mockReturnValue(activeFile),
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: makeBuildGraphMock(makePayload()),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    session.start(() => undefined);
    session.handleRuntimeReady();

    expect(sendGraph).toHaveBeenCalledTimes(1);
    expect(sendFocus).toHaveBeenCalledTimes(1);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId("Note.md"),
      path: "Note.md"
    });
  });

  it("does not send startup global focus when the active note is filtered out", async () => {
    const activeFile = makeTestTFile("Projects/ReverySky/Spec.md");
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
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
          getActiveFile: vi.fn().mockReturnValue(activeFile),
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: makeBuildGraphMock(makePathPayload()),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    await session.setState({ filterQuery: "path:Archive" });
    session.start(() => undefined);
    session.handleRuntimeReady();

    expect(sendGraph).toHaveBeenCalledTimes(1);
    expect((sendGraph.mock.calls[0]?.[0] as GraphPayload).notes.map((note) => note.id)).toEqual(["archive"]);
    expect(sendFocus).not.toHaveBeenCalled();
  });

  it("does not accept editor focus before the bridge is ready", async () => {
    const payload = makeEgoPayload();
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue(null),
          on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
        },
        vault: {
          getAbstractFileByPath: vi.fn((path: string) => makeTestTFile(path)),
          on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
        },
        workspace: {
          activeLeaf: null,
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: makeBuildGraphMock(payload),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    await session.setState({ egoEnabled: true });
    session.start(() => undefined);
    session.requestFocusFromEditor("Projects/ReverySky/Spec.md");

    expect(sendGraph).not.toHaveBeenCalled();
    expect(sendFocus).not.toHaveBeenCalled();

    session.handleRuntimeReady();

    expect(sendGraph).toHaveBeenCalledTimes(1);
    expect((sendGraph.mock.calls[0]?.[0] as GraphPayload).notes).toEqual([]);
    expect(sendFocus).not.toHaveBeenCalled();
  });

  it("rebuilds the startup Ego graph around the active note", async () => {
    const activeFile = makeTestTFile("Projects/ReverySky/Spec.md");
    const payload = makeEgoPayload();
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue(null),
          on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
        },
        vault: {
          getAbstractFileByPath: vi.fn((path: string) => makeTestTFile(path)),
          on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
        },
        workspace: {
          activeLeaf: null,
          getActiveFile: vi.fn().mockReturnValue(activeFile),
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: makeBuildGraphMock(payload),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    await session.setState({ egoEnabled: true });
    session.start(() => undefined);
    session.handleRuntimeReady();

    expect(sendGraph).toHaveBeenCalledTimes(1);
    const sentPayload = sendGraph.mock.calls[0]?.[0] as GraphPayload;
    expect(sentPayload.vault.noteCount).toBe(3);
    expect(sentPayload.notes.map((note) => note.id)).toEqual(["daily", "project", "archive"]);
    expect(sentPayload.links).toEqual([
      { sourceId: "daily", targetId: "project", kind: "resolved" },
      { sourceId: "project", targetId: "archive", kind: "resolved" }
    ]);
    expect(sendFocus).toHaveBeenCalledTimes(1);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId("Projects/ReverySky/Spec.md"),
      path: "Projects/ReverySky/Spec.md"
    });
  });

  it("rebuilds a queued startup Ego graph around the active note", async () => {
    vi.useFakeTimers();

    const metadataCallbacks: {
      changed?: (file: { path?: string }, data: string, cache: { links?: Array<{ link: string }>; tags?: Array<{ tag: string }> }) => void;
      resolved?: () => void;
    } = {};
    const activeFile = makeTestTFile("Projects/ReverySky/Spec.md");
    const payload = makeEgoPayload();
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue(null),
          on: vi.fn((name: "changed" | "resolved", callback: (...args: never[]) => void) => {
            if (name === "changed") {
              metadataCallbacks.changed = callback as typeof metadataCallbacks.changed;
            } else {
              metadataCallbacks.resolved = callback as typeof metadataCallbacks.resolved;
            }
            return { id: `metadata-${name}` };
          })
        },
        vault: {
          getAbstractFileByPath: vi.fn((path: string) => makeTestTFile(path)),
          on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
        },
        workspace: {
          activeLeaf: null,
          getActiveFile: vi.fn().mockReturnValue(activeFile),
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: makeBuildGraphMock(payload),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    await session.setState({ egoEnabled: true });
    session.start(() => undefined);
    metadataCallbacks.changed?.({ path: "Projects/ReverySky/Spec.md" }, "content", {
      links: [{ link: "Archive/Old.md" }]
    });
    metadataCallbacks.resolved?.();
    vi.advanceTimersByTime(250);

    expect(sendGraph).not.toHaveBeenCalled();

    session.handleRuntimeReady();

    expect(sendGraph).toHaveBeenCalledTimes(1);
    const sentPayload = sendGraph.mock.calls[0]?.[0] as GraphPayload;
    expect(sentPayload.vault.noteCount).toBe(3);
    expect(sentPayload.notes.map((note) => note.id)).toEqual(["daily", "project", "archive"]);
    expect(sendFocus).toHaveBeenCalledTimes(1);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId("Projects/ReverySky/Spec.md"),
      path: "Projects/ReverySky/Spec.md"
    });
  });

  it("does not send editor focus when the note is filtered out of the effective graph", () => {
    vi.useFakeTimers();

    const vaultCallbacks: {
      rename?: (file: { path?: string }, oldPath: string) => void;
    } = {};
    const payload = makePathPayload();
    const projectFile = makeTestTFile("Projects/ReverySky/Spec.md");
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue(null),
          on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
        },
        vault: {
          getAbstractFileByPath: vi.fn((path: string) => path === projectFile.path ? projectFile : null),
          on: vi.fn((name: "create" | "delete" | "rename", callback: (...args: never[]) => void) => {
            if (name === "rename") {
              vaultCallbacks.rename = callback as typeof vaultCallbacks.rename;
            }
            return { id: `vault-${name}` };
          })
        },
        workspace: {
          activeLeaf: null,
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: makeBuildGraphMock(payload),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    session.start(() => undefined);
    session.handleRuntimeReady();

    session.setFilterQuery("path:Archive");
    vi.advanceTimersByTime(500);
    session.requestFocusFromEditor("Projects/ReverySky/Spec.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect(sendFocus).not.toHaveBeenCalled();

    vaultCallbacks.rename?.({ path: "Projects/ReverySky/Renamed.md" }, "Projects/ReverySky/Spec.md");
    expect(sendFocus).not.toHaveBeenCalled();
  });

  it("rebuilds an Ego graph around editor focus without requiring membership in the previous graph", async () => {
    const payload = makeEgoPayload();
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue(null),
          on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
        },
        vault: {
          getAbstractFileByPath: vi.fn((path: string) => makeTestTFile(path)),
          on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
        },
        workspace: {
          activeLeaf: null,
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: makeBuildGraphMock(payload),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    await session.setState({ egoEnabled: true });
    session.start(() => undefined);
    session.handleRuntimeReady();

    expect(sendGraph).toHaveBeenCalledTimes(1);
    expect((sendGraph.mock.calls[0]?.[0] as GraphPayload).notes).toEqual([]);

    session.requestFocusFromEditor("Projects/ReverySky/Spec.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    let sentPayload = sendGraph.mock.calls[1]?.[0] as GraphPayload;
    expect(sentPayload.vault.noteCount).toBe(3);
    expect(sentPayload.notes.map((note) => note.id)).toEqual(["daily", "project", "archive"]);
    expect(sentPayload.links).toEqual([
      { sourceId: "daily", targetId: "project", kind: "resolved" },
      { sourceId: "project", targetId: "archive", kind: "resolved" }
    ]);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId("Projects/ReverySky/Spec.md"),
      path: "Projects/ReverySky/Spec.md"
    });

    session.requestFocusFromEditor("Inbox/Isolated.md");

    expect(sendGraph).toHaveBeenCalledTimes(3);
    sentPayload = sendGraph.mock.calls[2]?.[0] as GraphPayload;
    expect(sentPayload.vault.noteCount).toBe(1);
    expect(sentPayload.notes.map((note) => note.id)).toEqual(["isolated"]);
    expect(sentPayload.links).toEqual([]);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId("Inbox/Isolated.md"),
      path: "Inbox/Isolated.md"
    });
  });

  it("does not rebuild the Ego graph when focusing the current center again", async () => {
    let currentTime = 1700000000000;
    const payload = makeEgoPayload();
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue(null),
          on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
        },
        vault: {
          getAbstractFileByPath: vi.fn((path: string) => makeTestTFile(path)),
          on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
        },
        workspace: {
          activeLeaf: null,
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: makeBuildGraphMock(payload),
      now: () => currentTime,
      sendGraph,
      sendFocus
    });

    await session.setState({ egoEnabled: true });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.requestFocusFromEditor("Projects/ReverySky/Spec.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect(sendFocus).toHaveBeenCalledTimes(1);

    currentTime += 301;
    session.requestFocusFromEditor("Projects/ReverySky/Spec.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect(sendFocus).toHaveBeenCalledTimes(2);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId("Projects/ReverySky/Spec.md"),
      path: "Projects/ReverySky/Spec.md"
    });
  });

  it("sends Ego focus intent even when the center is missing from the current source graph", async () => {
    const payload = makeEgoPayload();
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue(null),
          on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
        },
        vault: {
          getAbstractFileByPath: vi.fn((path: string) => makeTestTFile(path)),
          on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
        },
        workspace: {
          activeLeaf: null,
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: makeBuildGraphMock(payload),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    await session.setState({ egoEnabled: true });
    session.start(() => undefined);
    session.handleRuntimeReady();

    session.requestFocusFromEditor("Inbox/New.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect((sendGraph.mock.calls[1]?.[0] as GraphPayload).notes).toEqual([]);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId("Inbox/New.md"),
      path: "Inbox/New.md"
    });
  });

  it("applies query filters before the Ego graph while keeping the center", async () => {
    vi.useFakeTimers();

    const payload = withStableNoteIds(makeEgoPayload());
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue(null),
          on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
        },
        vault: {
          getAbstractFileByPath: vi.fn((path: string) => makeTestTFile(path)),
          on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
        },
        workspace: {
          activeLeaf: null,
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: makeBuildGraphMock(payload),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    await session.setState({ egoEnabled: true });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.requestFocusFromEditor("Archive/Old.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect((sendGraph.mock.calls[1]?.[0] as GraphPayload).notes.map((note) => note.path)).toEqual([
      "Projects/ReverySky/Spec.md",
      "Archive/Old.md",
      "Projects/ReverySky/Neighbor.md"
    ]);

    session.setFilterQuery("path:Spec");
    vi.advanceTimersByTime(500);

    expect(sendGraph).toHaveBeenCalledTimes(3);
    const sentPayload = sendGraph.mock.calls[2]?.[0] as GraphPayload;
    expect(sentPayload.vault.noteCount).toBe(2);
    expect(sentPayload.notes.map((note) => note.path)).toEqual([
      "Projects/ReverySky/Spec.md",
      "Archive/Old.md"
    ]);
    expect(sentPayload.links).toEqual([
      {
        sourceId: makeStableNoteId("Projects/ReverySky/Spec.md"),
        targetId: makeStableNoteId("Archive/Old.md"),
        kind: "resolved"
      }
    ]);
  });

  it("builds the Ego graph to the configured depth and hides tags only on the boundary ring", async () => {
    const payload = makeDepthPayload();
    const sendGraph = vi.fn();
    const session = createEgoGraphSession(payload, { sendGraph });

    await session.setState({ egoEnabled: true, egoDepth: 2 });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.requestFocusFromEditor("Depth/Center.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    const sentPayload = sendGraph.mock.calls[1]?.[0] as GraphPayload;
    expect(sentPayload.vault.noteCount).toBe(5);
    expect(sentPayload.notes.map((note) => note.id)).toEqual([
      "center",
      "left",
      "right",
      "outer-left",
      "outer-right"
    ]);
    expect(sentPayload.links).toEqual([
      { sourceId: "center", targetId: "left", kind: "resolved" },
      { sourceId: "right", targetId: "center", kind: "resolved" },
      { sourceId: "left", targetId: "outer-left", kind: "resolved" },
      { sourceId: "outer-right", targetId: "right", kind: "resolved" }
    ]);
    expect(sentPayload.notes.map((note) => [note.id, note.tags])).toEqual([
      ["center", ["center"]],
      ["left", ["left"]],
      ["right", ["right"]],
      ["outer-left", []],
      ["outer-right", []]
    ]);
  });

  it("limits the Ego graph to depth one by default", async () => {
    const payload = makeDepthPayload();
    const sendGraph = vi.fn();
    const session = createEgoGraphSession(payload, { sendGraph });

    await session.setState({ egoEnabled: true });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.requestFocusFromEditor("Depth/Center.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    const sentPayload = sendGraph.mock.calls[1]?.[0] as GraphPayload;
    expect(sentPayload.vault.noteCount).toBe(3);
    expect(sentPayload.notes.map((note) => note.id)).toEqual(["center", "left", "right"]);
    expect(sentPayload.links).toEqual([
      { sourceId: "center", targetId: "left", kind: "resolved" },
      { sourceId: "right", targetId: "center", kind: "resolved" }
    ]);
    expect(sentPayload.notes.map((note) => [note.id, note.tags])).toEqual([
      ["center", ["center"]],
      ["left", []],
      ["right", []]
    ]);
  });

  it("expands and contracts the Ego graph when Ego depth changes", async () => {
    vi.useFakeTimers();
    const payload = makeDepthPayload();
    const sendGraph = vi.fn();
    const session = createEgoGraphSession(payload, { sendGraph });

    await session.setState({ egoEnabled: true });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.requestFocusFromEditor("Depth/Center.md");

    session.setEgoDepth(2);

    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect((sendGraph.mock.calls[1]?.[0] as GraphPayload).notes.map((note) => note.id)).toEqual([
      "center",
      "left",
      "right"
    ]);

    vi.advanceTimersByTime(250);
    expect(sendGraph).toHaveBeenCalledTimes(3);
    expect((sendGraph.mock.calls[2]?.[0] as GraphPayload).notes.map((note) => note.id)).toEqual([
      "center",
      "left",
      "right",
      "outer-left",
      "outer-right"
    ]);

    session.setEgoDepth(1);

    vi.advanceTimersByTime(250);
    expect(sendGraph).toHaveBeenCalledTimes(4);
    expect((sendGraph.mock.calls[3]?.[0] as GraphPayload).notes.map((note) => note.id)).toEqual([
      "center",
      "left",
      "right"
    ]);
  });

  it("coalesces rapid Ego depth changes into one graph send", async () => {
    vi.useFakeTimers();
    const payload = makeDepthPayload();
    const sendGraph = vi.fn();
    const session = createEgoGraphSession(payload, { sendGraph });

    await session.setState({ egoEnabled: true });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.requestFocusFromEditor("Depth/Center.md");

    session.setEgoDepth(2);
    session.setEgoDepth(3);
    session.setEgoDepth(1);

    expect(sendGraph).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(249);
    expect(sendGraph).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1);
    expect(sendGraph).toHaveBeenCalledTimes(3);
    expect((sendGraph.mock.calls[2]?.[0] as GraphPayload).notes.map((note) => note.id)).toEqual([
      "center",
      "left",
      "right"
    ]);
  });

  it("clears Global note focus when Unity activates a tag", async () => {
    vi.useFakeTimers();
    const payload = makeDepthPayload();
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = createEgoGraphSession(payload, { sendGraph, sendFocus });

    await session.setState({ egoEnabled: false });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.handleRuntimeFocusChange("Depth/Center.md");

    session.handleRuntimeTagActivate();
    session.setEgoEnabled(true);

    expect(sendGraph).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(250);
    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect((sendGraph.mock.calls[1]?.[0] as GraphPayload).notes).toEqual([]);
    expect(sendFocus).not.toHaveBeenCalled();
  });

  it("restores Ego center focus after Unity activates a tag and the Ego graph rebuilds", async () => {
    vi.useFakeTimers();
    const payload = makeDepthPayload();
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = createEgoGraphSession(payload, { sendGraph, sendFocus });

    await session.setState({ egoEnabled: true });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.requestFocusFromEditor("Depth/Center.md");

    session.handleRuntimeTagActivate();
    session.setEgoDepth(2);

    expect(sendGraph).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(250);
    expect(sendGraph).toHaveBeenCalledTimes(3);
    expect((sendGraph.mock.calls[2]?.[0] as GraphPayload).notes.map((note) => note.id)).toEqual([
      "center",
      "left",
      "right",
      "outer-left",
      "outer-right"
    ]);
    expect(sendFocus).toHaveBeenCalledTimes(2);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId("Depth/Center.md"),
      path: "Depth/Center.md"
    });
  });

  it("clears a tag-suspended Ego center when switching to Global before focus restore", async () => {
    vi.useFakeTimers();
    const payload = makeDepthPayload();
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = createEgoGraphSession(payload, { sendGraph, sendFocus });

    await session.setState({ egoEnabled: true });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.requestFocusFromEditor("Depth/Center.md");

    session.handleRuntimeTagActivate();
    session.setEgoEnabled(false);
    session.setEgoEnabled(true);

    expect(sendGraph).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(250);
    expect(sendGraph).toHaveBeenCalledTimes(3);
    expect((sendGraph.mock.calls[2]?.[0] as GraphPayload).notes).toEqual([]);
    expect(sendFocus).toHaveBeenCalledTimes(1);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId("Depth/Center.md"),
      path: "Depth/Center.md"
    });
  });

  it("keeps neighbor links out unless the Ego neighbor-links option is enabled", async () => {
    vi.useFakeTimers();
    const payload = makeDepthPayload();
    const sendGraph = vi.fn();
    const session = createEgoGraphSession(payload, { sendGraph });

    await session.setState({ egoEnabled: true, egoDepth: 2 });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.requestFocusFromEditor("Depth/Center.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect((sendGraph.mock.calls[1]?.[0] as GraphPayload).links).toEqual([
      { sourceId: "center", targetId: "left", kind: "resolved" },
      { sourceId: "right", targetId: "center", kind: "resolved" },
      { sourceId: "left", targetId: "outer-left", kind: "resolved" },
      { sourceId: "outer-right", targetId: "right", kind: "resolved" }
    ]);

    session.setEgoNeighborLinksEnabled(true);

    expect(sendGraph).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(250);
    expect(sendGraph).toHaveBeenCalledTimes(3);
    expect((sendGraph.mock.calls[2]?.[0] as GraphPayload).links).toEqual([
      { sourceId: "center", targetId: "left", kind: "resolved" },
      { sourceId: "right", targetId: "center", kind: "resolved" },
      { sourceId: "left", targetId: "outer-left", kind: "resolved" },
      { sourceId: "outer-right", targetId: "right", kind: "resolved" },
      { sourceId: "outer-left", targetId: "outer-right", kind: "resolved" }
    ]);
  });

  it("keeps Ego tag lines only on the ring that first exposes each tag when neighbor links are off", async () => {
    const payload = makeDepthPayload();
    const center = payload.notes.find((note) => note.id === "center");
    const outerLeft = payload.notes.find((note) => note.id === "outer-left");
    expect(center).toBeDefined();
    expect(outerLeft).toBeDefined();
    center!.tags = ["center", "shared"];
    outerLeft!.tags = ["outer-left", "shared"];
    const sendGraph = vi.fn();
    const session = createEgoGraphSession(payload, { sendGraph });

    await session.setState({ egoEnabled: true, egoDepth: 2 });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.requestFocusFromEditor("Depth/Center.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    const sentPayload = sendGraph.mock.calls[1]?.[0] as GraphPayload;
    expect(sentPayload.notes.map((note) => [note.id, note.tags])).toEqual([
      ["center", ["center", "shared"]],
      ["left", ["left"]],
      ["right", ["right"]],
      ["outer-left", []],
      ["outer-right", []]
    ]);
  });

  it("keeps Ego tag lines for same-ring owners that first expose the same tag", async () => {
    const payload = makeDepthPayload();
    const left = payload.notes.find((note) => note.id === "left");
    const right = payload.notes.find((note) => note.id === "right");
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    left!.tags = ["shared-ring"];
    right!.tags = ["shared-ring"];
    const sendGraph = vi.fn();
    const session = createEgoGraphSession(payload, { sendGraph });

    await session.setState({ egoEnabled: true, egoDepth: 2 });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.requestFocusFromEditor("Depth/Center.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    const sentPayload = sendGraph.mock.calls[1]?.[0] as GraphPayload;
    expect(sentPayload.notes.map((note) => [note.id, note.tags])).toEqual([
      ["center", ["center"]],
      ["left", ["shared-ring"]],
      ["right", ["shared-ring"]],
      ["outer-left", []],
      ["outer-right", []]
    ]);
  });

  it("drops a query-matched Ego boundary note when its path to the center is filtered out", async () => {
    vi.useFakeTimers();

    const payload = withStableNoteIds(makeDepthPayload());
    const sendGraph = vi.fn();
    const session = createEgoGraphSession(payload, { sendGraph });

    await session.setState({ egoEnabled: true, egoDepth: 2 });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.requestFocusFromEditor("Depth/Center.md");

    session.setFilterQuery("tag:#outer-left");
    vi.advanceTimersByTime(500);

    expect(sendGraph).toHaveBeenCalledTimes(3);
    const sentPayload = sendGraph.mock.calls[2]?.[0] as GraphPayload;
    expect(sentPayload.notes.map((note) => note.path)).toEqual(["Depth/Center.md"]);
    expect(sentPayload.notes.map((note) => [note.id, note.tags])).toEqual([
      [makeStableNoteId("Depth/Center.md"), ["center"]]
    ]);
  });

  it("uses the shortest Ego distance when a note is reachable through a cycle", async () => {
    const payload = makeDepthPayload();
    payload.links.splice(4, 0, { sourceId: "outer-left", targetId: "center", kind: "resolved" });
    const sendGraph = vi.fn();
    const session = createEgoGraphSession(payload, { sendGraph });

    await session.setState({ egoEnabled: true, egoDepth: 2 });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.requestFocusFromEditor("Depth/Center.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    const sentPayload = sendGraph.mock.calls[1]?.[0] as GraphPayload;
    expect(sentPayload.notes.map((note) => [note.id, note.tags])).toEqual([
      ["center", ["center"]],
      ["left", ["left"]],
      ["right", ["right"]],
      ["outer-left", ["outer-left"]],
      ["outer-right", []],
      ["far", []]
    ]);
    expect(sentPayload.links).toEqual([
      { sourceId: "center", targetId: "left", kind: "resolved" },
      { sourceId: "right", targetId: "center", kind: "resolved" },
      { sourceId: "outer-right", targetId: "right", kind: "resolved" },
      { sourceId: "outer-left", targetId: "center", kind: "resolved" },
      { sourceId: "outer-left", targetId: "outer-right", kind: "resolved" },
      { sourceId: "outer-left", targetId: "far", kind: "resolved" }
    ]);
  });

  it("rebuilds the Ego graph from Unity focus and gates the Obsidian echo", async () => {
    const payload = makeEgoPayload();
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue(null),
          on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
        },
        vault: {
          getAbstractFileByPath: vi.fn((path: string) => makeTestTFile(path)),
          on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
        },
        workspace: {
          activeLeaf: null,
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: makeBuildGraphMock(payload),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    await session.setState({ egoEnabled: true });
    session.start(() => undefined);
    session.handleRuntimeReady();

    session.handleRuntimeFocusChange("Archive/Old.md");
    session.expectFocusEchoForPath("Archive/Old.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    const sentPayload = sendGraph.mock.calls[1]?.[0] as GraphPayload;
    expect(sentPayload.vault.noteCount).toBe(3);
    expect(sentPayload.notes.map((note) => note.id)).toEqual(["project", "archive", "neighbor-note"]);
    expect(sentPayload.links).toEqual([
      { sourceId: "project", targetId: "archive", kind: "resolved" },
      { sourceId: "archive", targetId: "neighbor-note", kind: "resolved" }
    ]);
    expect(sendFocus).toHaveBeenCalledTimes(1);

    session.requestFocusFromEditor("Archive/Old.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect(sendFocus).toHaveBeenCalledTimes(1);
  });

  it("does not rebuild the Ego graph when Unity focuses the current center again", async () => {
    const payload = makeEgoPayload();
    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue(null),
          on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
        },
        vault: {
          getAbstractFileByPath: vi.fn((path: string) => makeTestTFile(path)),
          on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
        },
        workspace: {
          activeLeaf: null,
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: makeBuildGraphMock(payload),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    await session.setState({ egoEnabled: true });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.handleRuntimeFocusChange("Archive/Old.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect(sendFocus).toHaveBeenCalledTimes(1);

    session.handleRuntimeFocusChange("Archive/Old.md");

    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect(sendFocus).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the Ego graph around the renamed focus path", async () => {
    vi.useFakeTimers();

    const vaultCallbacks: {
      rename?: (file: { path?: string }, oldPath: string) => void;
    } = {};
    const oldPath = "Folder/Old.md";
    const newPath = "Folder/New.md";

    const payloadBefore = makePayload();
    payloadBefore.notes = [
      { id: makeStableNoteId(oldPath), path: oldPath, title: "Old", tags: [], date: "2026-01-03T00:00:00.000Z", size: 30 }
    ];
    payloadBefore.vault.noteCount = payloadBefore.notes.length;

    const payloadAfter = makePayload();
    payloadAfter.notes = [
      { id: makeStableNoteId(newPath), path: newPath, title: "New", tags: [], date: "2026-01-03T00:00:00.000Z", size: 30 }
    ];
    payloadAfter.vault.noteCount = payloadAfter.notes.length;

    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue(null),
          on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
        },
        vault: {
          getAbstractFileByPath: vi.fn((path: string) => makeTestTFile(path)),
          on: vi.fn((name: "create" | "delete" | "rename", callback: (...args: never[]) => void) => {
            if (name === "rename") {
              vaultCallbacks.rename = callback as typeof vaultCallbacks.rename;
            }
            return { id: `vault-${name}` };
          })
        },
        workspace: {
          activeLeaf: null,
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: vi
        .fn()
        .mockReturnValueOnce(payloadBefore)
        .mockReturnValueOnce(payloadAfter),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    await session.setState({ egoEnabled: true });
    session.start(() => undefined);
    session.handleRuntimeReady();
    session.requestFocusFromEditor(oldPath);

    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect((sendGraph.mock.calls[1]?.[0] as GraphPayload).notes.map((note) => note.path)).toEqual([oldPath]);

    vaultCallbacks.rename?.({ path: newPath }, oldPath);
    session.requestFocusFromEditor(newPath);

    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId(newPath),
      path: newPath
    });

    vi.advanceTimersByTime(250);

    expect(sendGraph).toHaveBeenCalledTimes(3);
    expect((sendGraph.mock.calls[2]?.[0] as GraphPayload).notes.map((note) => note.path)).toEqual([newPath]);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId(newPath),
      path: newPath
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
      buildGraph: makeBuildGraphMock(payload),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    session.start(() => undefined);
    session.handleRuntimeReady();
    session.handleRuntimeFocusChange("Folder/Old.md");

    vaultCallbacks.rename?.({ path: "Folder/New.md" }, "Folder/Old.md");
    vi.advanceTimersByTime(250);

    const sentPayload = sendGraph.mock.calls[0]?.[0] as GraphPayload;
    expect(sentPayload).toEqual({
      ...payload,
      mapLayout: "auto"
    });
    expect(sendFocus).toHaveBeenCalledTimes(1);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId("Folder/New.md"),
      path: "Folder/New.md"
    });
  });

  it("preserves focus on the last focused note after moving it outside the active markdown leaf", () => {
    vi.useFakeTimers();

    const vaultCallbacks: {
      rename?: (file: { path?: string }, oldPath: string) => void;
    } = {};

    const oldPath = "Folder/Old.md";
    const newPath = "Moved/New.md";
    const noteFile = makeTestTFile(oldPath);
    const payloadBefore = makePayload();
    payloadBefore.notes = [
      { id: makeStableNoteId(oldPath), path: oldPath, title: "Old", tags: [], date: "2026-01-03T00:00:00.000Z", size: 30 }
    ];
    payloadBefore.vault.noteCount = payloadBefore.notes.length;

    const payloadAfter = makePayload();
    payloadAfter.notes = [
      { id: makeStableNoteId(newPath), path: newPath, title: "New", tags: [], date: "2026-01-03T00:00:00.000Z", size: 30 }
    ];
    payloadAfter.vault.noteCount = payloadAfter.notes.length;

    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue(null),
          on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
        },
        vault: {
          getAbstractFileByPath: vi.fn((path: string) => path === oldPath ? noteFile : null),
          on: vi.fn((name: "create" | "delete" | "rename", callback: (...args: never[]) => void) => {
            if (name === "rename") {
              vaultCallbacks.rename = callback as typeof vaultCallbacks.rename;
            }
            return { id: `vault-${name}` };
          })
        },
        workspace: {
          activeLeaf: null,
          getLeavesOfType: vi.fn().mockReturnValue([]),
          iterateAllLeaves: vi.fn(),
          on: vi.fn().mockReturnValue({ id: "event-ref" })
        }
      } as never,
      buildGraph: vi
        .fn()
        .mockReturnValueOnce(payloadBefore)
        .mockReturnValueOnce(payloadAfter),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    session.start(() => undefined);
    session.handleRuntimeReady();
    session.requestFocusFromEditor(oldPath);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId(oldPath),
      path: oldPath
    });

    vaultCallbacks.rename?.({ path: newPath }, oldPath);
    vi.advanceTimersByTime(250);

    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect(sendFocus).toHaveBeenCalledTimes(2);
    expect(sendFocus).toHaveBeenLastCalledWith({
      id: makeStableNoteId(newPath),
      path: newPath
    });
  });

  it("clears focus after deleting the active note instead of choosing a replacement", () => {
    vi.useFakeTimers();

    const vaultCallbacks: {
      delete?: (file: { path?: string }) => void;
    } = {};

    const activeLeaf = {
      view: {
        getViewType: () => "markdown",
        file: { path: "Folder/Deleted.md" }
      }
    };

    const payload = makePayload();
    payload.notes = [
      { id: "replacement", path: "Folder/Replacement.md", title: "Replacement", tags: [], date: "2026-01-03T00:00:00.000Z", size: 30 }
    ];
    payload.vault.noteCount = payload.notes.length;

    const sendGraph = vi.fn();
    const sendFocus = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
        },
        vault: {
          on: vi.fn((name: "create" | "delete" | "rename", callback: (...args: never[]) => void) => {
            if (name === "delete") {
              vaultCallbacks.delete = callback as typeof vaultCallbacks.delete;
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
      } as never,
      buildGraph: makeBuildGraphMock(payload),
      now: () => 1700000000000,
      sendGraph,
      sendFocus
    });

    session.start(() => undefined);
    session.handleRuntimeReady();

    vaultCallbacks.delete?.({ path: "Folder/Deleted.md" });
    activeLeaf.view.file.path = "Folder/Replacement.md";
    vi.advanceTimersByTime(250);

    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect(sendFocus).not.toHaveBeenCalled();
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
      buildGraph,
      now: () => 1700000000000,
      sendGraph,
      sendFocus: vi.fn()
    });

    await session.setState({
      filterQuery: "tag:#project",
      showTags: false,
      mapLayout: "dates"
    });

    session.start(() => undefined);
    session.handleRuntimeReady();

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledTimes(1);
    const restoredPayload = sendGraph.mock.calls[0]?.[0] as GraphPayload;
    expect(restoredPayload.notes.map((note) => note.id)).toEqual(["project"]);
    expect(restoredPayload.notes[0]?.tags).toEqual([]);
    expect(restoredPayload.mapLayout).toBe("dates");

    session.setFilterQuery("path:archive");
    vi.advanceTimersByTime(500);

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledTimes(2);
    const updatedPayload = sendGraph.mock.calls[1]?.[0] as GraphPayload;
    expect(updatedPayload.notes.map((note) => note.id)).toEqual(["archive"]);
  });

  it("flushes pending settings graph work before runtime ready replays the graph", () => {
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
      buildGraph,
      now: () => 1700000000000,
      sendGraph,
      sendFocus: vi.fn()
    });

    session.start(() => undefined);
    session.handleRuntimeReady();

    session.setFilterQuery("path:archive");
    vi.advanceTimersByTime(500);
    session.setMapLayoutPreference("dates");

    session.handleRuntimeUnavailable();
    session.handleRuntimeReady();

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledTimes(3);
    const replayedPayload = sendGraph.mock.calls[2]?.[0] as GraphPayload;
    expect(replayedPayload.notes.map((note) => note.id)).toEqual(["archive"]);
    expect(replayedPayload.mapLayout).toBe("dates");

    vi.advanceTimersByTime(250);
    expect(sendGraph).toHaveBeenCalledTimes(3);
  });

  it("flushes pending filter graph work before runtime ready replays the graph", () => {
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
      buildGraph,
      now: () => 1700000000000,
      sendGraph,
      sendFocus: vi.fn()
    });

    session.start(() => undefined);
    session.handleRuntimeReady();

    session.setFilterQuery("path:archive");
    session.handleRuntimeUnavailable();
    session.handleRuntimeReady();

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(sendGraph).toHaveBeenCalledTimes(2);
    const replayedPayload = sendGraph.mock.calls[1]?.[0] as GraphPayload;
    expect(replayedPayload.notes.map((note) => note.id)).toEqual(["archive"]);

    vi.advanceTimersByTime(500);
    expect(sendGraph).toHaveBeenCalledTimes(2);
  });

  it("flushes pending source graph work before runtime ready replays the graph", () => {
    vi.useFakeTimers();

    const metadataCallbacks: {
      resolved?: () => void;
    } = {};

    const initialPayload = makePayload();
    const refreshedPayload = makePayload();
    refreshedPayload.notes[0].id = "refreshed";
    const buildGraph = vi.fn()
      .mockReturnValueOnce(initialPayload)
      .mockReturnValue(refreshedPayload);
    const sendGraph = vi.fn();
    const session = new MapSession({
      app: {
        metadataCache: {
          on: vi.fn((name: "changed" | "resolved", callback: (...args: never[]) => void) => {
            if (name === "resolved") {
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
      } as never,
      buildGraph,
      now: () => 1700000000000,
      sendGraph,
      sendFocus: vi.fn()
    });

    session.start(() => undefined);
    session.handleRuntimeReady();

    metadataCallbacks.resolved?.();
    session.handleRuntimeUnavailable();
    session.handleRuntimeReady();

    expect(buildGraph).toHaveBeenCalledTimes(2);
    expect(sendGraph).toHaveBeenCalledTimes(2);
    expect((sendGraph.mock.calls[1]?.[0] as GraphPayload).notes[0]?.id).toBe("refreshed");

    vi.advanceTimersByTime(250);
    expect(buildGraph).toHaveBeenCalledTimes(2);
    expect(sendGraph).toHaveBeenCalledTimes(2);
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
      buildGraph: makeBuildGraphMock(makePayload()),
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
