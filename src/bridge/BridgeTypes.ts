import type { MapLayoutPreference } from "./LayoutPreference";
export type { MapLayoutPreference } from "./LayoutPreference";

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

export type IncomingBridgeMessage = BridgeReadyMessage | NoteOpenMessage | RuntimeShutdownCompleteMessage;
export type OutgoingBridgeMessage = GraphSetMessage | NoteFocusMessage | RuntimeShutdownMessage;
