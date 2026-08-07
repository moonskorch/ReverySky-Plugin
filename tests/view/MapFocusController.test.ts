import { describe, expect, it, vi } from "vitest";
import type { MockedFunction } from "vitest";
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

type RequestFocusMock = MockedFunction<MapFocusControllerDependencies["requestFocus"]>;

function createController(options?: {
  now?: () => number;
  requestFocus?: RequestFocusMock;
  getFocusPath?: () => string;
  workspace?: WorkspaceMock;
}) {
  const requestFocus = (options?.requestFocus ?? vi.fn(() => true)) as RequestFocusMock;
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
    now: options?.now ?? (() => 0),
    requestFocus,
    getFocusPath: options?.getFocusPath ?? (() => "")
  });

  return {
    controller,
    requestFocus
  };
}

function expectFocusPath(requestFocus: RequestFocusMock, path: string): void {
  expect(requestFocus).toHaveBeenLastCalledWith(path);
}

describe("MapFocusController", () => {
  it("does not send startup focus", () => {
    const activeLeaf = makeMarkdownLeaf("Folder/Active.md");
    const { controller, requestFocus } = createController({
      workspace: {
        getActiveViewOfType: vi.fn().mockReturnValue({ leaf: activeLeaf }),
        getLeavesOfType: vi.fn().mockReturnValue([activeLeaf]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    });

    controller.start(() => undefined);

    expect(requestFocus).not.toHaveBeenCalled();
  });

  it("requests focus immediately for markdown editor focus", () => {
    const { controller, requestFocus } = createController();

    controller.onMarkdownFocus("Folder/Current.md");

    expect(requestFocus).toHaveBeenCalledTimes(1);
    expectFocusPath(requestFocus, "Folder/Current.md");
  });

  it("ignores non-markdown focus paths", () => {
    let onFileOpen: ((file: { path?: string } | null) => void) | null = null;
    const { controller, requestFocus } = createController({
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
    controller.onMarkdownFocus("Folder/Current.txt");
    const handleFileOpen = onFileOpen as unknown as FileOpenCallback;
    handleFileOpen(makeFile("Folder/New.txt"));

    expect(requestFocus).not.toHaveBeenCalled();
  });

  it("requests focus for active file changes", () => {
    let onFileOpen: ((file: { path?: string } | null) => void) | null = null;
    const { controller, requestFocus } = createController({
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

    expect(requestFocus).toHaveBeenCalledTimes(1);
    expectFocusPath(requestFocus, "Folder/Next.md");
  });

  it("coalesces duplicate focus for the same note in a short window", () => {
    let currentTime = 1000;
    const { controller, requestFocus } = createController({
      now: () => currentTime
    });

    controller.onMarkdownFocus("Folder/Current.md");
    controller.onMarkdownFocus("Folder/Current.md");

    expect(requestFocus).toHaveBeenCalledTimes(1);
    expectFocusPath(requestFocus, "Folder/Current.md");

    currentTime += 301;
    controller.onMarkdownFocus("Folder/Current.md");

    expect(requestFocus).toHaveBeenCalledTimes(2);
    expectFocusPath(requestFocus, "Folder/Current.md");
  });

  it("does not gate focus when the session rejects the request", () => {
    const requestFocus = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true) as RequestFocusMock;
    const { controller } = createController({ requestFocus });

    controller.onMarkdownFocus("Folder/Current.md");
    controller.onMarkdownFocus("Folder/Current.md");

    expect(requestFocus).toHaveBeenCalledTimes(2);
    expectFocusPath(requestFocus, "Folder/Current.md");
  });

  it("consumes the expected focus echo after a Unity note open", () => {
    let currentTime = 1000;
    const { controller, requestFocus } = createController({
      now: () => currentTime
    });

    controller.expectFocusEchoForPath("Folder/Current.md");
    controller.onMarkdownFocus("Folder/Current.md");

    expect(requestFocus).not.toHaveBeenCalled();

    controller.onMarkdownFocus("Folder/Current.md");

    expect(requestFocus).not.toHaveBeenCalled();

    currentTime += 301;
    controller.onMarkdownFocus("Folder/Current.md");

    expect(requestFocus).toHaveBeenCalledTimes(1);
    expectFocusPath(requestFocus, "Folder/Current.md");
  });

  it("extends the focus gate while consuming duplicate focus", () => {
    let currentTime = 1000;
    const { controller, requestFocus } = createController({
      now: () => currentTime
    });

    controller.expectFocusEchoForPath("Folder/Current.md");
    currentTime += 200;
    controller.onMarkdownFocus("Folder/Current.md");
    currentTime += 200;
    controller.onMarkdownFocus("Folder/Current.md");

    expect(requestFocus).not.toHaveBeenCalled();

    currentTime += 301;
    controller.onMarkdownFocus("Folder/Current.md");

    expect(requestFocus).toHaveBeenCalledTimes(1);
    expectFocusPath(requestFocus, "Folder/Current.md");
  });

  it("does not consume a stale expected focus echo", () => {
    let currentTime = 1000;
    const { controller, requestFocus } = createController({
      now: () => currentTime
    });

    controller.expectFocusEchoForPath("Folder/Current.md");
    currentTime += 301;
    controller.onMarkdownFocus("Folder/Current.md");

    expect(requestFocus).toHaveBeenCalledTimes(1);
    expectFocusPath(requestFocus, "Folder/Current.md");
  });

  it("clears expected focus echo when another note receives focus", () => {
    const { controller, requestFocus } = createController();

    controller.expectFocusEchoForPath("Folder/Opened.md");
    controller.onMarkdownFocus("Folder/Other.md");

    expect(requestFocus).toHaveBeenCalledTimes(1);
    expectFocusPath(requestFocus, "Folder/Other.md");
  });

  it("requests rename focus without checking the current graph when the renamed note is focused", () => {
    const renamedLeaf = makeMarkdownLeaf("Folder/New.md");
    const { controller, requestFocus } = createController({
      getFocusPath: () => "Folder/Old.md",
      workspace: {
        getActiveViewOfType: vi.fn().mockReturnValue({ leaf: renamedLeaf }),
        getLeavesOfType: vi.fn().mockReturnValue([renamedLeaf]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    });

    controller.onRename("Folder/Old.md", "Folder/New.md");

    expect(requestFocus).toHaveBeenCalledTimes(1);
    expect(requestFocus).toHaveBeenLastCalledWith("Folder/New.md", {
      skipGraphCheck: true,
      skipLocalGraphRebuild: true
    });
  });

  it("consumes focus echo after rename focus is accepted", () => {
    let currentTime = 1000;
    const { controller, requestFocus } = createController({
      getFocusPath: () => "Folder/Old.md",
      now: () => currentTime
    });

    controller.onRename("Folder/Old.md", "Folder/New.md");
    controller.onMarkdownFocus("Folder/New.md");

    expect(requestFocus).toHaveBeenCalledTimes(1);
    expect(requestFocus).toHaveBeenLastCalledWith("Folder/New.md", {
      skipGraphCheck: true,
      skipLocalGraphRebuild: true
    });

    currentTime += 301;
    controller.onMarkdownFocus("Folder/New.md");

    expect(requestFocus).toHaveBeenCalledTimes(2);
    expectFocusPath(requestFocus, "Folder/New.md");
  });

  it("preserves rename focus for the last focused map note when markdown is not active", () => {
    const { controller, requestFocus } = createController({
      getFocusPath: () => "Folder/Old.md",
      workspace: {
        getActiveViewOfType: vi.fn().mockReturnValue(null),
        getLeavesOfType: vi.fn().mockReturnValue([]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    });

    controller.onRename("Folder/Old.md", "Moved/New.md");

    expect(requestFocus).toHaveBeenCalledTimes(1);
    expect(requestFocus).toHaveBeenLastCalledWith("Moved/New.md", {
      skipGraphCheck: true,
      skipLocalGraphRebuild: true
    });
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
