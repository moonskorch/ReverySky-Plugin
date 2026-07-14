import { describe, expect, it, vi } from "vitest";
import type { MockedFunction } from "vitest";
import { makeStableNoteId } from "../../src/graph/VaultGraphBuilder";
import {
  MapFocusController,
  type MapFocusControllerDependencies
} from "../../src/view/MapFocusController";

function makeMarkdownLeaf(path: string) {
  return {
    view: {
      getViewType: () => "markdown",
      file: { path }
    }
  };
}

function makeFile(path: string) {
  return { path };
}

type FileOpenCallback = (file: { path?: string } | null) => void;

type WorkspaceMock = {
  getActiveViewOfType: (...args: never[]) => unknown;
  getLeavesOfType: (...args: never[]) => unknown[];
  iterateAllLeaves: (...args: never[]) => void;
  on: (eventName: string, callback: FileOpenCallback) => { id: string };
};

type SendFocusMock = MockedFunction<MapFocusControllerDependencies["sendFocus"]>;

function createController(options?: {
  isBridgeReady?: () => boolean;
  now?: () => number;
  sendFocus?: SendFocusMock;
  workspace?: WorkspaceMock;
}) {
  const sendFocus = (options?.sendFocus ?? vi.fn()) as SendFocusMock;
  const workspace: WorkspaceMock = options?.workspace ?? {
    getActiveViewOfType: vi.fn(),
    getLeavesOfType: vi.fn().mockReturnValue([]),
    iterateAllLeaves: vi.fn(),
    on: vi.fn().mockReturnValue({ id: "event-ref" })
  };
  const controller = new MapFocusController({
    app: {
      workspace
    } as never,
    isBridgeReady: options?.isBridgeReady ?? (() => true),
    now: options?.now ?? (() => 0),
    sendFocus
  });

  return {
    controller,
    sendFocus
  };
}

function expectFocusPayload(sendFocus: SendFocusMock, path: string): void {
  expect(sendFocus).toHaveBeenLastCalledWith({
    id: makeStableNoteId(path),
    path
  });
}

describe("MapFocusController", () => {
  it("does not send startup focus", () => {
    const activeLeaf = makeMarkdownLeaf("Folder/Active.md");
    const { controller, sendFocus } = createController({
      workspace: {
        getActiveViewOfType: vi.fn().mockReturnValue({ leaf: activeLeaf }),
        getLeavesOfType: vi.fn().mockReturnValue([activeLeaf]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    });

    controller.start(() => undefined);

    expect(sendFocus).not.toHaveBeenCalled();
  });

  it("sends focus immediately for markdown editor focus when the bridge is ready", () => {
    const { controller, sendFocus } = createController();

    controller.onMarkdownFocus("Folder/Current.md");

    expect(sendFocus).toHaveBeenCalledTimes(1);
    expectFocusPayload(sendFocus, "Folder/Current.md");
  });

  it("drops focus while the bridge is not ready", () => {
    let onFileOpen: ((file: { path?: string } | null) => void) | null = null;
    const { controller, sendFocus } = createController({
      isBridgeReady: () => false,
      workspace: {
        getActiveViewOfType: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([]),
        iterateAllLeaves: vi.fn(),
        on: (eventName: string, callback: (file: { path?: string } | null) => void) => {
          if (eventName === "file-open") {
            onFileOpen = callback;
          }
          return { id: "event-ref" };
        }
      }
    });

    controller.start(() => undefined);
    controller.onMarkdownFocus("Folder/Current.md");
    const handleFileOpen = onFileOpen as unknown as FileOpenCallback;
    handleFileOpen(makeFile("Folder/New.md"));

    expect(sendFocus).not.toHaveBeenCalled();
  });

  it("sends focus for active file changes", () => {
    let onFileOpen: ((file: { path?: string } | null) => void) | null = null;
    const { controller, sendFocus } = createController({
      workspace: {
        getActiveViewOfType: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([]),
        iterateAllLeaves: vi.fn(),
        on: (eventName: string, callback: (file: { path?: string } | null) => void) => {
          if (eventName === "file-open") {
            onFileOpen = callback;
          }
          return { id: "event-ref" };
        }
      }
    });

    controller.start(() => undefined);
    const handleFileOpen = onFileOpen as unknown as FileOpenCallback;
    handleFileOpen(makeFile("Folder/Next.md"));

    expect(sendFocus).toHaveBeenCalledTimes(1);
    expectFocusPayload(sendFocus, "Folder/Next.md");
  });

  it("coalesces duplicate focus for the same note in a short window", () => {
    let currentTime = 1000;
    const { controller, sendFocus } = createController({
      now: () => currentTime
    });

    controller.onMarkdownFocus("Folder/Current.md");
    controller.onMarkdownFocus("Folder/Current.md");

    expect(sendFocus).toHaveBeenCalledTimes(1);
    expectFocusPayload(sendFocus, "Folder/Current.md");

    currentTime += 251;
    controller.onMarkdownFocus("Folder/Current.md");

    expect(sendFocus).toHaveBeenCalledTimes(2);
    expectFocusPayload(sendFocus, "Folder/Current.md");
  });

  it("consumes the expected focus echo after a Unity note open", () => {
    let currentTime = 1000;
    const { controller, sendFocus } = createController({
      now: () => currentTime
    });

    controller.expectFocusEchoForPath("Folder/Current.md");
    controller.onMarkdownFocus("Folder/Current.md");

    expect(sendFocus).not.toHaveBeenCalled();

    controller.onMarkdownFocus("Folder/Current.md");

    expect(sendFocus).not.toHaveBeenCalled();

    currentTime += 251;
    controller.onMarkdownFocus("Folder/Current.md");

    expect(sendFocus).toHaveBeenCalledTimes(1);
    expectFocusPayload(sendFocus, "Folder/Current.md");
  });

  it("extends the focus gate while consuming duplicate focus", () => {
    let currentTime = 1000;
    const { controller, sendFocus } = createController({
      now: () => currentTime
    });

    controller.expectFocusEchoForPath("Folder/Current.md");
    currentTime += 200;
    controller.onMarkdownFocus("Folder/Current.md");
    currentTime += 200;
    controller.onMarkdownFocus("Folder/Current.md");

    expect(sendFocus).not.toHaveBeenCalled();

    currentTime += 251;
    controller.onMarkdownFocus("Folder/Current.md");

    expect(sendFocus).toHaveBeenCalledTimes(1);
    expectFocusPayload(sendFocus, "Folder/Current.md");
  });

  it("does not consume a stale expected focus echo", () => {
    let currentTime = 1000;
    const { controller, sendFocus } = createController({
      now: () => currentTime
    });

    controller.expectFocusEchoForPath("Folder/Current.md");
    currentTime += 251;
    controller.onMarkdownFocus("Folder/Current.md");

    expect(sendFocus).toHaveBeenCalledTimes(1);
    expectFocusPayload(sendFocus, "Folder/Current.md");
  });

  it("clears expected focus echo when another note receives focus", () => {
    const { controller, sendFocus } = createController();

    controller.expectFocusEchoForPath("Folder/Opened.md");
    controller.onMarkdownFocus("Folder/Other.md");

    expect(sendFocus).toHaveBeenCalledTimes(1);
    expectFocusPayload(sendFocus, "Folder/Other.md");
  });

  it("sends rename focus only when the renamed markdown note is active", () => {
    const renamedLeaf = makeMarkdownLeaf("Folder/New.md");
    const { controller, sendFocus } = createController({
      workspace: {
        getActiveViewOfType: vi.fn().mockReturnValue({ leaf: renamedLeaf }),
        getLeavesOfType: vi.fn().mockReturnValue([renamedLeaf]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    });

    controller.onRename("Folder/Old.md", "Folder/New.md");

    expect(sendFocus).toHaveBeenCalledTimes(1);
    expectFocusPayload(sendFocus, "Folder/New.md");
  });

  it("resolves open-link source from current workspace without cached history", () => {
    let activeLeaf = makeMarkdownLeaf("Folder/A.md");
    const { controller } = createController({
      workspace: {
        getActiveViewOfType: vi.fn(() => ({ leaf: activeLeaf })),
        getLeavesOfType: vi.fn(() => [activeLeaf]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    });

    expect(controller.resolveOpenLinkSourcePath()).toBe("Folder/A.md");
    activeLeaf = makeMarkdownLeaf("Folder/B.md");
    expect(controller.resolveOpenLinkSourcePath()).toBe("Folder/B.md");
  });
});
