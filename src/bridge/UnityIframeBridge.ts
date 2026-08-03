import {
  BRIDGE_PROTOCOL_VERSION,
  NoteFocusMessage,
  NoteFocusPayload,
  GraphPayload,
  GraphSetMessage,
  IncomingBridgeMessage,
  NoteOpenPayload,
  OutgoingBridgeMessage,
  RuntimeScreenshotRequestMessage,
  RuntimeSettingsMessage,
  RuntimeSettingsPayload,
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

type PendingRuntimeScreenshot = {
  requestId: string;
  resolve: (blob: Blob) => void;
  reject: (error: Error) => void;
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
  private pendingRuntimeScreenshot: PendingRuntimeScreenshot | null = null;
  private requestSequence = 0;
  private readonly onMessageRef = (event: MessageEvent) => this.onMessage(event);

  /**
   * Replace any previous iframe listener so only one runtime is active.
   */
  attach(iframeWindow: Window, callbacks: BridgeCallbacks, messageWindow: Window = window): void {
    this.resolvePendingShutdown("superseded");
    this.rejectPendingRuntimeScreenshot("superseded");

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
    this.rejectPendingRuntimeScreenshot("superseded");

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
    const iframeWindow = this.getIframeWindowForSend();
    if (!iframeWindow) {
      return;
    }

    const payloadErrors = MessageValidator.validateGraphPayload(payload);
    if (this.reportValidationErrors("Invalid graph payload", payloadErrors)) {
      return;
    }

    const message: GraphSetMessage = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      type: "graph:set",
      requestId: this.createRequestId(),
      payload
    };

    this.postOutgoingMessage(iframeWindow, message);
  }

  sendStatus(text: string): void {
    const iframeWindow = this.getIframeWindowForSend({ reportError: false });
    if (!iframeWindow) {
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

    this.postOutgoingMessage(iframeWindow, message);
  }

  sendRuntimeSettings(payload: RuntimeSettingsPayload): void {
    const iframeWindow = this.getIframeWindowForSend();
    if (!iframeWindow) {
      return;
    }

    const payloadErrors = MessageValidator.validateRuntimeSettingsPayload(payload);
    if (this.reportValidationErrors("Invalid runtime settings payload", payloadErrors)) {
      return;
    }

    const message: RuntimeSettingsMessage = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      type: "runtime:settings",
      payload
    };

    this.postOutgoingMessage(iframeWindow, message);
  }

  requestRuntimeScreenshot(timeoutMs = 2000): Promise<Blob> {
    const iframeWindow = this.getIframeWindowForSend();
    if (!iframeWindow) {
      return Promise.reject(new Error("Bridge is not attached to iframe window."));
    }

    this.rejectPendingRuntimeScreenshot("superseded");

    const requestId = this.createRequestId();
    const message: RuntimeScreenshotRequestMessage = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      type: "runtime:screenshot-request",
      requestId
    };

    return new Promise((resolve, reject) => {
      const timeoutWindow = this.messageWindow ?? window;
      const timeoutId = timeoutWindow.setTimeout(() => {
        this.rejectPendingRuntimeScreenshot("timeout");
      }, timeoutMs);

      this.pendingRuntimeScreenshot = {
        requestId,
        resolve,
        reject,
        timeoutId,
        timeoutWindow
      };

      try {
        this.postOutgoingMessage(iframeWindow, message);
      } catch (error) {
        this.rejectPendingRuntimeScreenshot(error instanceof Error ? error.message : "postMessage failed");
      }
    });
  }

  sendNoteFocus(payload: NoteFocusPayload): void {
    const iframeWindow = this.getIframeWindowForSend();
    if (!iframeWindow) {
      return;
    }

    const payloadErrors = MessageValidator.validateNoteFocusPayload(payload);
    if (this.reportValidationErrors("Invalid note focus payload", payloadErrors)) {
      return;
    }

    const message: NoteFocusMessage = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      type: "note:focus",
      requestId: `req_${Date.now()}`,
      payload
    };

    this.postOutgoingMessage(iframeWindow, message);
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
      return;
    }

    if (data.type === "runtime:screenshot-result") {
      const incomingErrors = MessageValidator.validateIncomingRuntimeScreenshotResultMessage(data);
      if (incomingErrors.length > 0) {
        this.callbacks.onError?.(`Invalid incoming bridge message: ${incomingErrors.join("; ")}`);
        return;
      }
      if (this.pendingRuntimeScreenshot?.requestId !== data.requestId) {
        return;
      }
      this.resolvePendingRuntimeScreenshot(data.payload.blob);
      return;
    }

    if (data.type === "runtime:screenshot-error") {
      const incomingErrors = MessageValidator.validateIncomingRuntimeScreenshotErrorMessage(data);
      if (incomingErrors.length > 0) {
        this.callbacks.onError?.(`Invalid incoming bridge message: ${incomingErrors.join("; ")}`);
        return;
      }
      if (this.pendingRuntimeScreenshot?.requestId !== data.requestId) {
        return;
      }
      this.rejectPendingRuntimeScreenshot(data.payload.message);
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

  private resolvePendingRuntimeScreenshot(blob: Blob): void {
    const pendingRuntimeScreenshot = this.pendingRuntimeScreenshot;
    if (!pendingRuntimeScreenshot) {
      return;
    }

    pendingRuntimeScreenshot.timeoutWindow.clearTimeout(pendingRuntimeScreenshot.timeoutId);
    this.pendingRuntimeScreenshot = null;
    pendingRuntimeScreenshot.resolve(blob);
  }

  private rejectPendingRuntimeScreenshot(reason: string): void {
    const pendingRuntimeScreenshot = this.pendingRuntimeScreenshot;
    if (!pendingRuntimeScreenshot) {
      return;
    }

    pendingRuntimeScreenshot.timeoutWindow.clearTimeout(pendingRuntimeScreenshot.timeoutId);
    this.pendingRuntimeScreenshot = null;
    pendingRuntimeScreenshot.reject(new Error(`Screenshot request ${reason}.`));
  }

  private createRequestId(): string {
    this.requestSequence += 1;
    return `req_${Date.now()}_${this.requestSequence}`;
  }

  private getIframeWindowForSend(options: { reportError?: boolean } = {}): Window | null {
    if (this.iframeWindow) {
      return this.iframeWindow;
    }

    if (options.reportError !== false) {
      this.callbacks.onError?.("Bridge is not attached to iframe window.");
    }
    return null;
  }

  private reportValidationErrors(prefix: string, errors: string[]): boolean {
    if (errors.length === 0) {
      return false;
    }

    this.callbacks.onError?.(`${prefix}: ${errors.join("; ")}`);
    return true;
  }

  private postOutgoingMessage(iframeWindow: Window, message: OutgoingBridgeMessage): void {
    iframeWindow.postMessage(message, "*");
  }
}
