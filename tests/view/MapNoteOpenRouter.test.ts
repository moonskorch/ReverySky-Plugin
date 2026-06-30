import { describe, expect, it, vi } from "vitest";
import type { GraphPayload } from "../../src/bridge/BridgeTypes";
import { MapNoteOpenRouter } from "../../src/view/MapNoteOpenRouter";
import { MapSession } from "../../src/view/MapSession";
import { makeBuildGraphMock } from "./testUtils";

function makePayload(): GraphPayload {
  return {
    graphVersion: "0.0.1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    vault: { noteCount: 1 },
    notes: [
      {
        id: "note_1",
        path: "Folder/Note.md",
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

function createSession(app: unknown, payload: GraphPayload) {
  const session = new MapSession({
    app: app as never,
    buildGraph: makeBuildGraphMock(payload),
    now: () => 1700000000000,
    sendGraph: vi.fn(),
    sendFocus: vi.fn()
  });
  session.start(() => undefined);
  session.setBridgeReady(true);
  session.flushOrRefresh();
  return session;
}

describe("MapNoteOpenRouter", () => {
  it("opens note by id with path fallback", async () => {
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
        }),
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
      },
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      workspace: {
        activeLeaf,
        getLeavesOfType: vi.fn().mockReturnValue([activeLeaf]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" }),
        openLinkText
      }
    };

    const session = createSession(app, makePayload());
    const notify = vi.fn();
    const router = new MapNoteOpenRouter(app as never, session, notify);

    await router.openRequestedNote({ id: "note_1", path: "Fallback/Other.md" });
    expect(openLinkText).toHaveBeenCalledWith("Folder/Note.md", "", false, {
      active: true
    });
    expect(openLinkText.mock.calls[0]?.[3]).not.toHaveProperty("group");
    expect(notify).not.toHaveBeenCalled();
  });

  it("uses markdown source path and lets Obsidian choose the target leaf", async () => {
    const markdownLeaf = {
      view: {
        getViewType: () => "markdown",
        file: { path: "Folder/Context.md" }
      }
    };
    const mapLeaf = {
      view: {
        getViewType: () => "reverysky-map-view"
      }
    };

    const openLinkText = vi.fn().mockResolvedValue(undefined);
    const app = {
      vault: {
        getAbstractFileByPath: vi.fn().mockReturnValue({ path: "Folder/Note.md" }),
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
      },
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      workspace: {
        activeLeaf: mapLeaf,
        getLeavesOfType: vi.fn().mockReturnValue([markdownLeaf]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" }),
        openLinkText
      }
    };

    const session = createSession(app, makePayload());
    const router = new MapNoteOpenRouter(app as never, session, vi.fn());

    await router.openRequestedNote({ id: "note_1", path: "Folder/Note.md" });
    expect(openLinkText).toHaveBeenCalledWith("Folder/Note.md", "Folder/Context.md", false, {
      active: true
    });
    expect(openLinkText.mock.calls[0]?.[3]).not.toHaveProperty("group");
  });

  it("notifies on missing id/path or missing file", async () => {
    const app = {
      vault: {
        getAbstractFileByPath: vi.fn().mockReturnValue(null),
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
      },
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      workspace: {
        activeLeaf: null,
        getLeavesOfType: vi.fn().mockReturnValue([]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" }),
        openLinkText: vi.fn()
      }
    };

    const session = createSession(app, makePayload());
    const notify = vi.fn();
    const router = new MapNoteOpenRouter(app as never, session, notify);

    await router.openRequestedNote({} as never);
    await router.openRequestedNote({ id: "missing", path: "Missing.md" });

    expect(notify).toHaveBeenNthCalledWith(
      1,
      "Unable to open note: bridge payload did not include a valid note id and path."
    );
    expect(notify).toHaveBeenNthCalledWith(
      2,
      "Unable to open note: file not found for path 'Missing.md'."
    );
  });
});
