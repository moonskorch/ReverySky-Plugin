# Unity Runtime Data Contract (Subset)

This document defines the Unity-side subset of the bridge contract used by runtime ingestion.

Canonical source:
- `../../docs/DATA_CONTRACT.md`

If this file conflicts with canonical contract, canonical contract wins.

## Protocol Gate
- `protocolVersion` must match expected version exactly.
- Runtime-ready signal is `bridge:ready`.
- Runtime ingestion message is `graph:set`.

## Envelope Shape
Expected envelope:

```json
{
  "protocolVersion": "1.0.0",
  "type": "graph:set",
  "requestId": "req_optional",
  "payload": {}
}
```

Required fields for Unity ingestion:
- `protocolVersion` (string)
- `type` (must be `graph:set`)
- `payload` (object)

Optional field:
- `requestId` (string)

## Payload Subset Used by Unity Runtime

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

## Unity Ingestion Invariants
- `vault.noteCount` equals `notes.length`.
- `id` is required and stable across updates.
- `path` is vault-relative with `/` separators.
- Links reference existing note ids.
- Unknown fields are ignored, not fatal.

## Error Handling Expectations
- Invalid envelope or protocol mismatch must be rejected gracefully.
- Repeated `graph:set` calls must rebuild or update runtime state without stale leftovers.
- Errors must be explicit and non-crashing.

## Baseline Test Payloads (for EditMode tests)
Use compact deterministic payloads:

1. Minimal valid payload:
- 1 note, 0 links, matching `noteCount`.

2. Small connected payload:
- 3 notes, 2 links, stable ids, valid paths.

3. Repeat-apply payload pair:
- payload A then payload B with changed notes/links;
- verify no stale nodes/edges remain after second apply.
