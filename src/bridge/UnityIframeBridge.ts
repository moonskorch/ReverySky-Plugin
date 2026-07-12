import {
  BRIDGE_PROTOCOL_VERSION,
  NoteFocusMessage,
  NoteFocusPayload,
  GraphPayload,
  GraphSetMessage,
  IncomingBridgeMessage,
  NoteOpenPayload,
  RuntimeShutdownMessage,
  RuntimeStatusMessage,
  ShutdownResult
} from "./BridgeTypes";
import { MessageValidator } from "./MessageValidator";

type BridgeCallbacks = {
  onReady?: () => void;
  onGraphReady?: (requestId: string) => void;
  onNoteOpen?: (payload: NoteOpenPayload) => void;
  onError?: (message: string) => void;
};

type PendingShutdown = {
  requestId: string;
  resolve: (result: ShutdownResult) => void;
  timeoutId: number;
  timeoutWindow: Window;
};

/**
 * Thin postMessage transport for the Unity iframe.
 * It owns attachment, validation, and routing of incoming bridge events.
 */
export class UnityIframeBridge {
  private iframeWindow: Window | null = null;
  private messageWindow: Window | null = null;
  private attached = false;
  private callbacks: BridgeCallbacks = {};
  private pendingShutdown: PendingShutdown | null = null;
  private requestSequence = 0;
  private readonly onMessageRef = (event: MessageEvent) => this.onMessage(event);

  /**
   * Replace any previous iframe listener so only one runtime is active.
   */
  attach(iframeWindow: Window, callbacks: BridgeCallbacks, messageWindow: Window = window): void {
    this.resolvePendingShutdown("superseded");

    if (this.attached) {
      this.detach();
    }

    this.iframeWindow = iframeWindow;
    this.messageWindow = messageWindow;
    this.callbacks = callbacks;
    this.messageWindow.addEventListener("message", this.onMessageRef);
    this.attached = true;
  }

  detach(): void {
    this.resolvePendingShutdown("superseded");

    if (!this.attached) {
      return;
    }

    this.messageWindow?.removeEventListener("message", this.onMessageRef);
    this.iframeWindow = null;
    this.messageWindow = null;
    this.callbacks = {};
    this.attached = false;
  }

  shutdown(timeoutMs = 300): Promise<ShutdownResult> {
    if (!this.attached || !this.iframeWindow) {
      return Promise.resolve("not-attached");
    }

    this.resolvePendingShutdown("superseded");

    const requestId = `shutdown_${Date.now()}`;
    const message: RuntimeShutdownMessage = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      type: "runtime:shutdown",
      requestId
    };

    return new Promise((resolve) => {
      const timeoutWindow = this.messageWindow ?? window;
      const timeoutId = timeoutWindow.setTimeout(() => {
        this.resolvePendingShutdown("timeout");
      }, timeoutMs);

      this.pendingShutdown = {
        requestId,
        resolve,
        timeoutId,
        timeoutWindow
      };

      try {
        this.iframeWindow?.postMessage(message, "*");
      } catch {
        this.resolvePendingShutdown("timeout");
      }
    });
  }

  sendGraphSet(payload: GraphPayload): void {
    if (!this.iframeWindow) {
      this.callbacks.onError?.("Bridge is not attached to iframe window.");
      return;
    }

    const payloadErrors = MessageValidator.validateGraphPayload(payload);
    if (payloadErrors.length > 0) {
      this.callbacks.onError?.(`Invalid graph payload: ${payloadErrors.join("; ")}`);
      return;
    }

    const message: GraphSetMessage = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      type: "graph:set",
      requestId: this.createRequestId(),
      payload
    };

    this.iframeWindow.postMessage(message, "*");
  }

  sendStatus(text: string): void {
    if (!this.iframeWindow) {
      return;
    }

    const safeText = typeof text === "string" ? text.trim() : "";
    if (!safeText) {
      return;
    }

    const message: RuntimeStatusMessage = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      type: "runtime:status",
      payload: {
        text: safeText
      }
    };

    this.iframeWindow.postMessage(message, "*");
  }

  sendNoteFocus(payload: NoteFocusPayload): void {
    if (!this.iframeWindow) {
      this.callbacks.onError?.("Bridge is not attached to iframe window.");
      return;
    }

    const noteId = typeof payload.id === "string" ? payload.id.trim() : "";
    const notePath = typeof payload.path === "string" ? payload.path.trim() : "";
    if (!noteId || !notePath) {
      this.callbacks.onError?.("Invalid note focus payload: id and path are required.");
      return;
    }

    const message: NoteFocusMessage = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      type: "note:focus",
      requestId: `req_${Date.now()}`,
      payload: {
        id: noteId,
        path: notePath
      }
    };

    this.iframeWindow.postMessage(message, "*");
  }

  /**
   * Only accept messages from the attached iframe and route known bridge events.
   */
  private onMessage(event: MessageEvent): void {
    if (!this.iframeWindow || event.source !== this.iframeWindow) {
      return;
    }

    const data = event.data as IncomingBridgeMessage | undefined;
    if (!data || typeof data !== "object") {
      return;
    }

    if (data.type === "bridge:ready") {
      const incomingErrors = MessageValidator.validateIncomingReadyMessage(data);
      if (incomingErrors.length > 0) {
        this.callbacks.onError?.(`Invalid incoming bridge message: ${incomingErrors.join("; ")}`);
        return;
      }
      this.callbacks.onReady?.();
      return;
    }

    if (data.type === "note:open") {
      const incomingErrors = MessageValidator.validateIncomingNoteOpenMessage(data);
      if (incomingErrors.length > 0) {
        this.callbacks.onError?.(`Invalid incoming bridge message: ${incomingErrors.join("; ")}`);
        return;
      }
      this.callbacks.onNoteOpen?.(data.payload);
      return;
    }

    if (data.type === "graph:ready") {
      const incomingErrors = MessageValidator.validateIncomingGraphReadyMessage(data);
      if (incomingErrors.length > 0) {
        this.callbacks.onError?.(`Invalid incoming bridge message: ${incomingErrors.join("; ")}`);
        return;
      }
      this.callbacks.onGraphReady?.(data.requestId);
      return;
    }

    if (data.type === "runtime:shutdown-complete") {
      const incomingErrors = MessageValidator.validateIncomingShutdownCompleteMessage(data);
      if (incomingErrors.length > 0) {
        return;
      }
      if (this.pendingShutdown?.requestId !== data.requestId) {
        return;
      }
      this.resolvePendingShutdown("complete");
    }
  }

  private resolvePendingShutdown(result: ShutdownResult): void {
    const pendingShutdown = this.pendingShutdown;
    if (!pendingShutdown) {
      return;
    }

    pendingShutdown.timeoutWindow.clearTimeout(pendingShutdown.timeoutId);
    this.pendingShutdown = null;
    pendingShutdown.resolve(result);
  }

  private createRequestId(): string {
    this.requestSequence += 1;
    return `req_${Date.now()}_${this.requestSequence}`;
  }
}
