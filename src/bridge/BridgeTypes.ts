export const BRIDGE_PROTOCOL_VERSION = "1.0.0";

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

export type NoteOpenMessage = {
  protocolVersion: string;
  type: "note:open";
  requestId?: string;
  payload: NoteOpenPayload;
};

export type GraphNoteNode = {
  id: string;
  path: string;
  title: string;
  tags: string[];
  dates: {
    created?: string;
    modified?: string;
    noteDate?: string;
  };
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
};

export type GraphSetMessage = {
  protocolVersion: string;
  type: "graph:set";
  requestId?: string;
  payload: GraphPayload;
};

export type IncomingBridgeMessage = BridgeReadyMessage | NoteOpenMessage;
