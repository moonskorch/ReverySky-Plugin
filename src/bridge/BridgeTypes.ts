import type { MapLayoutPreference } from "./LayoutPreference";
import type { FrameRateMode } from "./FrameRateMode";
export type { MapLayoutPreference } from "./LayoutPreference";
export type { FrameRateMode } from "./FrameRateMode";

export const BRIDGE_PROTOCOL_VERSION = "2.0.0";

/**
 * Shared bridge message and payload types.
 * Keep this contract aligned with the iframe runtime.
 */
export type BridgeReadyMessage = {
  protocolVersion: string;
  type: "bridge:ready";
  requestId?: string;
  payload?: Record<string, never>;
};

export type NoteIdentityPayload = {
  id: string;
  path: string;
};

export type NoteOpenPayload = NoteIdentityPayload;

export type NoteFocusPayload = NoteIdentityPayload;

export type TagActivatePayload = {
  tag: string;
};

export type NoteOpenMessage = {
  protocolVersion: string;
  type: "note:open";
  requestId?: string;
  payload: NoteOpenPayload;
};

export type NoteFocusMessage = {
  protocolVersion: string;
  type: "note:focus";
  requestId?: string;
  payload: NoteFocusPayload;
};

export type TagActivateMessage = {
  protocolVersion: string;
  type: "tag:activate";
  requestId?: string;
  payload: TagActivatePayload;
};

export type GraphReadyMessage = {
  protocolVersion: string;
  type: "graph:ready";
  requestId: string;
};

export type RuntimeShutdownMessage = {
  protocolVersion: string;
  type: "runtime:shutdown";
  requestId: string;
};

export type RuntimeShutdownCompleteMessage = {
  protocolVersion: string;
  type: "runtime:shutdown-complete";
  requestId: string;
};

export type RuntimeScreenshotRequestMessage = {
  protocolVersion: string;
  type: "runtime:screenshot-request";
};

export type RuntimeScreenshotResponseMessage = {
  protocolVersion: string;
  type: "runtime:screenshot-response";
  payload:
    | {
        ok: true;
        blob: Blob;
      }
    | {
        ok: false;
      };
};

export type RuntimeStatusMessage = {
  protocolVersion: string;
  type: "runtime:status";
  payload: {
    text: string;
  };
};

export type RuntimeSettingsPayload = {
  frameRateMode: FrameRateMode;
};

export type RuntimeSettingsMessage = {
  protocolVersion: string;
  type: "runtime:settings";
  payload: RuntimeSettingsPayload;
};

export type ShutdownResult = "complete" | "timeout" | "not-attached" | "superseded";

export type GraphNoteNode = {
  id: string;
  path: string;
  title: string;
  tags: string[];
  date?: string;
  size: number;
};

export type GraphLink = {
  sourceId: string;
  targetId: string;
  weight?: number;
  kind?: "resolved";
};

export type GraphPayload = {
  graphVersion: string;
  generatedAt: string;
  vault: {
    noteCount: number;
  };
  notes: GraphNoteNode[];
  links: GraphLink[];
  mapLayout?: MapLayoutPreference;
};

export type GraphSetMessage = {
  protocolVersion: string;
  type: "graph:set";
  requestId?: string;
  payload: GraphPayload;
};

export type IncomingBridgeMessage =
  | BridgeReadyMessage
  | GraphReadyMessage
  | NoteOpenMessage
  | TagActivateMessage
  | RuntimeScreenshotResponseMessage
  | RuntimeShutdownCompleteMessage;
export type OutgoingBridgeMessage =
  | GraphSetMessage
  | NoteFocusMessage
  | RuntimeScreenshotRequestMessage
  | RuntimeShutdownMessage
  | RuntimeStatusMessage
  | RuntimeSettingsMessage;
