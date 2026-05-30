import {
  BRIDGE_PROTOCOL_VERSION,
  NoteFocusMessage,
  NoteFocusPayload,
  GraphPayload,
  GraphSetMessage,
  IncomingBridgeMessage,
  NoteOpenPayload
} from "./BridgeTypes";
import { MessageValidator } from "./MessageValidator";

type BridgeCallbacks = {
  onReady?: () => void;
  onNoteOpen?: (payload: NoteOpenPayload) => void;
  onError?: (message: string) => void;
};

export class UnityIframeBridge {
  private iframeWindow: Window | null = null;
  private attached = false;
  private callbacks: BridgeCallbacks = {};
  private readonly onMessageRef = (event: MessageEvent) => this.onMessage(event);

  attach(iframeWindow: Window, callbacks: BridgeCallbacks): void {
    if (this.attached) {
      this.detach();
    }

    this.iframeWindow = iframeWindow;
    this.callbacks = callbacks;
    window.addEventListener("message", this.onMessageRef);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) {
      return;
    }

    window.removeEventListener("message", this.onMessageRef);
    this.iframeWindow = null;
    this.callbacks = {};
    this.attached = false;
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
      requestId: `req_${Date.now()}`,
      payload
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
    if (!noteId && !notePath) {
      this.callbacks.onError?.("Invalid note focus payload: id or path is required.");
      return;
    }

    const message: NoteFocusMessage = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      type: "note:focus",
      requestId: `req_${Date.now()}`,
      payload: {
        id: noteId || undefined,
        path: notePath || undefined
      }
    };

    this.iframeWindow.postMessage(message, "*");
  }

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
      this.callbacks.onNoteOpen?.(data.payload ?? {});
    }
  }
}
