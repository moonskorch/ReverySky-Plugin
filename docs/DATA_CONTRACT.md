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
- `graph:set`: effective filtered graph payload.
- `note:focus`: current-note focus hint with optional `id` and `path`.

Runtime -> plugin:
- `bridge:ready`: runtime is initialized and ready to receive payloads.
- `note:open`: request for Obsidian to open a note by `id` and/or `path`.

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
  enginePreference?: GraphEnginePreference;
};

type GraphEnginePreference = "auto" | "forces" | "static25D" | "staticLinks";

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
- `enginePreference`, when provided, must be one of: `auto`, `forces`, `static25D`, `staticLinks`.
- Producer rule: `vault.noteCount` should equal `notes.length` for every emitted payload.
- Unknown fields must be safely ignored by consumers.

## Validation Requirements
- Outgoing `graph:set` payloads are validated before postMessage dispatch.
- Incoming `bridge:ready` is accepted only when `protocolVersion` matches exactly.
- Incoming `note:open` is accepted only when `protocolVersion` matches and the payload includes a non-empty `id` or `path`.
- Invalid envelopes are rejected with explicit, non-fatal error reporting.
- Unity runtime ingest is fail-soft: it treats `vault.noteCount` as informational (uses `notes` as source of truth).
- Unity runtime ingest is fail-soft for unresolved links: missing endpoints are tolerated at ingest and dropped later during edge resolution.
- `enginePreference` is optional and controls the preferred runtime map engine selection when the consumer supports it.

## Unity Runtime Usage Reference
- Unity-side field-to-behavior mapping, runtime defaults, and ingestion-specific fallbacks are documented in `unity/ReverySkyMap/docs/DATA_CONTRACT.md` under `Runtime Field Usage (Unity)`.

## Current Producer Semantics
- `graph:set` is the effective filtered payload emitted by the plugin view, not the raw vault snapshot.
- `notes[].date` uses `frontmatter.date`, then `frontmatter.created`, then `frontmatter.created_at`, then file creation time. Missing, blank, or invalid candidates are skipped, and the field is omitted when no valid source exists.
- `notes[].tags` are produced by merging inline tags and frontmatter tags, then normalizing and deduplicating the result.
- `notes[].size` is emitted as file size in bytes.
- `enginePreference`, when present, is a plugin-owned runtime hint and travels with the effective graph payload.
- `vault.noteCount` reflects the emitted `notes.length` for the filtered payload.
