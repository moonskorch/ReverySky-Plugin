import { describe, expect, it, vi } from "vitest";
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

describe("UnityIframeBridge", () => {
  it("sends graph:set for valid payload", () => {
    const bridge = new UnityIframeBridge();
    const postMessage = vi.fn();
    const iframeWindow = { postMessage } as unknown as Window;

    bridge.attach(iframeWindow, {});
    bridge.sendGraphSet(makeValidPayload());

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message, targetOrigin] = postMessage.mock.calls[0] as [Record<string, unknown>, string];
    expect(targetOrigin).toBe("*");
    expect(message.type).toBe("graph:set");
    expect(message.protocolVersion).toBe(BRIDGE_PROTOCOL_VERSION);
    bridge.detach();
  });

  it("sends note:focus when id or path is provided", () => {
    const bridge = new UnityIframeBridge();
    const postMessage = vi.fn();
    const iframeWindow = { postMessage } as unknown as Window;

    bridge.attach(iframeWindow, {});
    bridge.sendNoteFocus({ path: "Folder/Note.md" });

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message, targetOrigin] = postMessage.mock.calls[0] as [Record<string, unknown>, string];
    expect(targetOrigin).toBe("*");
    expect(message.type).toBe("note:focus");
    expect(message.protocolVersion).toBe(BRIDGE_PROTOCOL_VERSION);
    bridge.detach();
  });

  it("reports error and does not send note:focus when payload is empty", () => {
    const bridge = new UnityIframeBridge();
    const postMessage = vi.fn();
    const onError = vi.fn();
    const iframeWindow = { postMessage } as unknown as Window;

    bridge.attach(iframeWindow, { onError });
    bridge.sendNoteFocus({});

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
});
