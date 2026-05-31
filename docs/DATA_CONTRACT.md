# ReverySky Map Bridge Data Contract

## Protocol Version
- `protocolVersion`: `2.0.0`

## Envelope
All bridge messages use this shape:

```json
{
  "protocolVersion": "2.0.0",
  "type": "graph:set",
  "requestId": "req_...",
  "payload": {}
}
```

Fields:
- `protocolVersion` (required, string)
- `type` (required, string)
- `requestId` (optional, string)
- `payload` (required, object)

## Message Types
Plugin -> runtime:
- `graph:set`: full graph payload

Runtime -> plugin:
- `bridge:ready`: runtime is initialized and ready to receive payloads

## Graph Payload
```ts
type GraphPayload = {
  graphVersion: string;
  generatedAt: string;
  vault: {
    noteCount: number;
  };
  notes: GraphNoteNode[];
  links: GraphLink[];
};

type GraphNoteNode = {
  id: string;
  path: string;
  title: string;
  tags: string[];
  date?: string;
  size: number;
};

type GraphLink = {
  sourceId: string;
  targetId: string;
  weight?: number;
  kind?: "resolved";
};
```

## Normalization Rules
- `path` must be vault-relative and use `/` separators.
- `id` must be stable for the same note across sessions.
- `date` must be a single canonical note date in ISO 8601 format when provided.
- `size` must be a non-negative integer measured in bytes.
- Producer rule: `vault.noteCount` should equal `notes.length` for every emitted payload.
- Unknown fields must be safely ignored by consumers.

## Validation Requirements
- Outgoing `graph:set` payloads are validated before postMessage dispatch.
- Incoming `bridge:ready` is accepted only when `protocolVersion` matches exactly.
- Invalid envelopes are rejected with explicit, non-fatal error reporting.
- Unity runtime ingest is fail-soft: it treats `vault.noteCount` as informational (uses `notes` as source of truth).
- Unity runtime ingest is fail-soft for unresolved links: missing endpoints are tolerated at ingest and dropped later during edge resolution.

## Unity Runtime Usage Reference
- Unity-side field-to-behavior mapping, runtime defaults, and ingestion-specific fallbacks are documented in `unity/ReverySkyMap/docs/DATA_CONTRACT.md` under `Runtime Field Usage (Unity)`.
