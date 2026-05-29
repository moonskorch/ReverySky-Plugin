import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphPayload } from "../../src/bridge/BridgeTypes";
import type { ReverySkyMapViewDependencies } from "../../src/view/ReverySkyMapView";

import { ReverySkyMapView } from "../../src/view/ReverySkyMapView";

type BridgeCallbacks = {
  onReady?: () => void;
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
    const app = { marker: "app" };
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
});
