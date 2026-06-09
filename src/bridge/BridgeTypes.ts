import type { GraphEnginePreference } from "./EnginePreference";

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

export type NoteOpenPayload = {
  id?: string;
  path?: string;
};

export type NoteFocusPayload = {
  id?: string;
  path?: string;
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
  enginePreference?: GraphEnginePreference;
};

export type GraphSetMessage = {
  protocolVersion: string;
  type: "graph:set";
  requestId?: string;
  payload: GraphPayload;
};

export type IncomingBridgeMessage = BridgeReadyMessage | NoteOpenMessage;
export type OutgoingBridgeMessage = GraphSetMessage | NoteFocusMessage;
