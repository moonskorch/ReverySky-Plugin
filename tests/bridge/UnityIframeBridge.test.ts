import { afterEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_PROTOCOL_VERSION, GraphPayload } from "../../src/bridge/BridgeTypes";
import { UnityIframeBridge } from "../../src/bridge/UnityIframeBridge";

function makeValidPayload(): GraphPayload {
  return {
    graphVersion: "0.0.1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    vault: {
      noteCount: 1
    },
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

function dispatchMessage(data: unknown, source: unknown): void {
  const event = new MessageEvent("message", {
    data,
    source: source as MessageEventSource
  });
  window.dispatchEvent(event);
}

function createMessageWindow(): Window & {
  dispatchMessageEvent: (data: unknown, source: unknown) => void;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  setTimeout: ReturnType<typeof vi.fn>;
  clearTimeout: ReturnType<typeof vi.fn>;
} {
  const target = new EventTarget();
  const addEventListener = vi.fn(target.addEventListener.bind(target));
  const removeEventListener = vi.fn(target.removeEventListener.bind(target));
  const setTimeout = vi.fn(window.setTimeout.bind(window));
  const clearTimeout = vi.fn(window.clearTimeout.bind(window));
  return {
    addEventListener,
    removeEventListener,
    setTimeout,
    clearTimeout,
    dispatchMessageEvent: (data: unknown, source: unknown) => {
      target.dispatchEvent(
        new MessageEvent("message", {
          data,
          source: source as MessageEventSource
        })
      );
    }
  } as unknown as Window & {
    dispatchMessageEvent: (data: unknown, source: unknown) => void;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    setTimeout: ReturnType<typeof vi.fn>;
    clearTimeout: ReturnType<typeof vi.fn>;
  };
}

describe("UnityIframeBridge", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends graph:set for valid payload", () => {
    const bridge = new UnityIframeBridge();
    const postMessage = vi.fn();
    const iframeWindow = { postMessage } as unknown as Window;
    const payload = makeValidPayload();
    payload.mapLayout = "dynamicLinks";

    bridge.attach(iframeWindow, {});
    bridge.sendGraphSet(payload);

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message, targetOrigin] = postMessage.mock.calls[0] as [Record<string, unknown>, string];
    expect(targetOrigin).toBe("*");
    expect(message.type).toBe("graph:set");
    expect(message.protocolVersion).toBe(BRIDGE_PROTOCOL_VERSION);
    expect((message.payload as GraphPayload).mapLayout).toBe("dynamicLinks");
    bridge.detach();
  });

  it("sends note:focus when id and path are provided", () => {
    const bridge = new UnityIframeBridge();
    const postMessage = vi.fn();
    const iframeWindow = { postMessage } as unknown as Window;

    bridge.attach(iframeWindow, {});
    bridge.sendNoteFocus({ id: "note_1", path: "Folder/Note.md" });

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message, targetOrigin] = postMessage.mock.calls[0] as [Record<string, unknown>, string];
    expect(targetOrigin).toBe("*");
    expect(message.type).toBe("note:focus");
    expect(message.protocolVersion).toBe(BRIDGE_PROTOCOL_VERSION);
    bridge.detach();
  });

  it("reports error and does not send note:focus when payload is incomplete", () => {
    const bridge = new UnityIframeBridge();
    const postMessage = vi.fn();
    const onError = vi.fn();
    const iframeWindow = { postMessage } as unknown as Window;

    bridge.attach(iframeWindow, { onError });
    bridge.sendNoteFocus({ path: "Folder/Note.md" } as never);

    expect(postMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toContain("Invalid note focus payload");
    bridge.detach();
  });

  it("reports error and does not send when payload is invalid", () => {
    const bridge = new UnityIframeBridge();
    const postMessage = vi.fn();
    const onError = vi.fn();
    const iframeWindow = { postMessage } as unknown as Window;
    const payload = makeValidPayload();
    payload.generatedAt = "invalid";

    bridge.attach(iframeWindow, { onError });
    bridge.sendGraphSet(payload);

    expect(postMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toContain("Invalid graph payload");
    bridge.detach();
  });

  it("invokes onReady only for bridge:ready from attached iframe source", () => {
    const bridge = new UnityIframeBridge();
    const onReady = vi.fn();
    const iframeWindow = { postMessage: vi.fn() } as unknown as Window;

    bridge.attach(iframeWindow, { onReady });
    dispatchMessage(
      {
        type: "bridge:ready",
        protocolVersion: BRIDGE_PROTOCOL_VERSION
      },
      iframeWindow
    );

    expect(onReady).toHaveBeenCalledTimes(1);
    bridge.detach();
  });

  it("accepts bridge:ready from the popout window that owns the iframe", () => {
    const bridge = new UnityIframeBridge();
    const onReady = vi.fn();
    const iframeWindow = { postMessage: vi.fn() } as unknown as Window;
    const popoutWindow = createMessageWindow();

    (
      bridge.attach as unknown as (
        iframeWindow: Window,
        callbacks: { onReady?: () => void },
        messageWindow: Window
      ) => void
    )(iframeWindow, { onReady }, popoutWindow);

    expect(popoutWindow.addEventListener).toHaveBeenCalledWith("message", expect.any(Function));

    popoutWindow.dispatchMessageEvent(
      {
        type: "bridge:ready",
        protocolVersion: BRIDGE_PROTOCOL_VERSION
      },
      iframeWindow
    );

    expect(onReady).toHaveBeenCalledTimes(1);
    bridge.detach();
    expect(popoutWindow.removeEventListener).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("ignores message from another source", () => {
    const bridge = new UnityIframeBridge();
    const onReady = vi.fn();
    const iframeWindow = { postMessage: vi.fn() } as unknown as Window;
    const otherSource = { postMessage: vi.fn() };

    bridge.attach(iframeWindow, { onReady });
    dispatchMessage(
      {
        type: "bridge:ready",
        protocolVersion: BRIDGE_PROTOCOL_VERSION
      },
      otherSource
    );

    expect(onReady).not.toHaveBeenCalled();
    bridge.detach();
  });

  it("invokes onNoteOpen for valid note:open from attached iframe source", () => {
    const bridge = new UnityIframeBridge();
    const onNoteOpen = vi.fn();
    const iframeWindow = { postMessage: vi.fn() } as unknown as Window;

    bridge.attach(iframeWindow, { onNoteOpen });
    dispatchMessage(
      {
        type: "note:open",
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        payload: {
          id: "note_1",
          path: "Folder/Note.md"
        }
      },
      iframeWindow
    );

    expect(onNoteOpen).toHaveBeenCalledTimes(1);
    expect(onNoteOpen).toHaveBeenCalledWith({
      id: "note_1",
      path: "Folder/Note.md"
    });
    bridge.detach();
  });

  it("removes listener on detach", () => {
    const bridge = new UnityIframeBridge();
    const onReady = vi.fn();
    const iframeWindow = { postMessage: vi.fn() } as unknown as Window;

    bridge.attach(iframeWindow, { onReady });
    bridge.detach();
    dispatchMessage(
      {
        type: "bridge:ready",
        protocolVersion: BRIDGE_PROTOCOL_VERSION
      },
      iframeWindow
    );

    expect(onReady).not.toHaveBeenCalled();
  });

  it("shutdown sends runtime:shutdown with protocol version and requestId", async () => {
    const bridge = new UnityIframeBridge();
    const postMessage = vi.fn();
    const iframeWindow = { postMessage } as unknown as Window;

    bridge.attach(iframeWindow, {});
    const shutdownPromise = bridge.shutdown(1000);

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message, targetOrigin] = postMessage.mock.calls[0] as [Record<string, unknown>, string];
    expect(targetOrigin).toBe("*");
    expect(message.protocolVersion).toBe(BRIDGE_PROTOCOL_VERSION);
    expect(message.type).toBe("runtime:shutdown");
    expect(message.requestId).toEqual(expect.stringMatching(/^shutdown_\d+$/));

    dispatchMessage(
      {
        type: "runtime:shutdown-complete",
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: message.requestId
      },
      iframeWindow
    );
    await expect(shutdownPromise).resolves.toBe("complete");
    bridge.detach();
  });

  it("shutdown resolves complete for matching runtime:shutdown-complete from attached iframe source", async () => {
    const bridge = new UnityIframeBridge();
    const postMessage = vi.fn();
    const iframeWindow = { postMessage } as unknown as Window;

    bridge.attach(iframeWindow, {});
    const shutdownPromise = bridge.shutdown(1000);
    const [message] = postMessage.mock.calls[0] as [Record<string, unknown>, string];

    dispatchMessage(
      {
        type: "runtime:shutdown-complete",
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: message.requestId
      },
      iframeWindow
    );

    await expect(shutdownPromise).resolves.toBe("complete");
    bridge.detach();
  });

  it("shutdown ignores runtime:shutdown-complete from another source", async () => {
    vi.useFakeTimers();
    const bridge = new UnityIframeBridge();
    const postMessage = vi.fn();
    const iframeWindow = { postMessage } as unknown as Window;
    const otherSource = { postMessage: vi.fn() };

    bridge.attach(iframeWindow, {});
    const shutdownPromise = bridge.shutdown(10);
    const [message] = postMessage.mock.calls[0] as [Record<string, unknown>, string];

    dispatchMessage(
      {
        type: "runtime:shutdown-complete",
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: message.requestId
      },
      otherSource
    );
    await vi.advanceTimersByTimeAsync(10);

    await expect(shutdownPromise).resolves.toBe("timeout");
    bridge.detach();
  });

  it("shutdown ignores mismatched runtime:shutdown-complete requestId", async () => {
    vi.useFakeTimers();
    const bridge = new UnityIframeBridge();
    const postMessage = vi.fn();
    const iframeWindow = { postMessage } as unknown as Window;

    bridge.attach(iframeWindow, {});
    const shutdownPromise = bridge.shutdown(10);

    dispatchMessage(
      {
        type: "runtime:shutdown-complete",
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: "shutdown_other"
      },
      iframeWindow
    );
    await vi.advanceTimersByTimeAsync(10);

    await expect(shutdownPromise).resolves.toBe("timeout");
    bridge.detach();
  });

  it("shutdown resolves timeout when no runtime ack arrives", async () => {
    vi.useFakeTimers();
    const bridge = new UnityIframeBridge();
    const iframeWindow = { postMessage: vi.fn() } as unknown as Window;

    bridge.attach(iframeWindow, {});
    const shutdownPromise = bridge.shutdown(10);
    await vi.advanceTimersByTimeAsync(10);

    await expect(shutdownPromise).resolves.toBe("timeout");
    bridge.detach();
  });

  it("shutdown resolves not-attached when no iframe is attached", async () => {
    const bridge = new UnityIframeBridge();

    await expect(bridge.shutdown()).resolves.toBe("not-attached");
  });

  it("attach supersedes a pending shutdown", async () => {
    const bridge = new UnityIframeBridge();
    const iframeWindow = { postMessage: vi.fn() } as unknown as Window;
    const nextIframeWindow = { postMessage: vi.fn() } as unknown as Window;

    bridge.attach(iframeWindow, {});
    const shutdownPromise = bridge.shutdown(1000);
    bridge.attach(nextIframeWindow, {});

    await expect(shutdownPromise).resolves.toBe("superseded");
    bridge.detach();
  });

  it("detach supersedes a pending shutdown and removes listener from the message window", async () => {
    const bridge = new UnityIframeBridge();
    const iframeWindow = { postMessage: vi.fn() } as unknown as Window;
    const popoutWindow = createMessageWindow();

    (
      bridge.attach as unknown as (
        iframeWindow: Window,
        callbacks: Record<string, never>,
        messageWindow: Window
      ) => void
    )(iframeWindow, {}, popoutWindow);
    const shutdownPromise = bridge.shutdown(1000);
    bridge.detach();

    await expect(shutdownPromise).resolves.toBe("superseded");
    expect(popoutWindow.removeEventListener).toHaveBeenCalledWith("message", expect.any(Function));
  });
});
