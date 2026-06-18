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
- `payload` (required for payload-carrying messages, omitted for runtime shutdown messages)

## Message Types
Plugin -> runtime:
- `graph:set`: effective filtered graph payload.
- `note:focus`: current-note focus hint with optional `id` and `path`.
- `runtime:shutdown`: lifecycle message requesting the iframe runtime wrapper to stop bridge activity before the parent view detaches.

Runtime -> plugin:
- `bridge:ready`: runtime is initialized and ready to receive payloads.
- `note:open`: request for Obsidian to open a note by `id` and/or `path`.
- `runtime:shutdown-complete`: acknowledgement for a matching `runtime:shutdown` request.

## Runtime Shutdown Messages
`runtime:shutdown` is a bridge/runtime-wrapper lifecycle handshake, not a full Unity engine teardown.

Parent -> runtime:

```json
{
  "protocolVersion": "2.0.0",
  "type": "runtime:shutdown",
  "requestId": "shutdown_..."
}
```

Runtime -> parent:

```json
{
  "protocolVersion": "2.0.0",
  "type": "runtime:shutdown-complete",
  "requestId": "shutdown_..."
}
```

Rules:
- `requestId` is required for both shutdown messages.
- The parent only accepts `runtime:shutdown-complete` from the attached iframe source and only when `requestId` matches the pending shutdown.
- The iframe JS wrapper enters shutdown mode, stops its own outgoing bridge messages, removes its own message, resize, and WebGL context loss listeners, and replies with `runtime:shutdown-complete`.
- The Unity C# `ObsidianBridge` treats shutdown as a bridge guard: it stops accepting `graph:set` and `note:focus`, and stops sending `note:open`.
- Shutdown does not call Unity quit APIs, does not destroy Unity scene objects, and does not manually tear down the iframe.

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
  mapLayout?: MapLayoutPreference;
};

type MapLayoutPreference = "auto" | "dynamicLinks" | "dates" | "scalableLinks";

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
- `mapLayout`, when provided, must be one of: `auto`, `dynamicLinks`, `dates`, `scalableLinks`.
- Producer rule: `vault.noteCount` should equal `notes.length` for every emitted payload.
- Unknown fields must be safely ignored by consumers.

## Validation Requirements
- Outgoing `graph:set` payloads are validated before postMessage dispatch.
- Incoming `bridge:ready` is accepted only when `protocolVersion` matches exactly.
- Incoming `note:open` is accepted only when `protocolVersion` matches and the payload includes a non-empty `id` or `path`.
- Incoming `runtime:shutdown-complete` is accepted only when `protocolVersion` matches and `requestId` is a non-empty string matching the pending shutdown request.
- Invalid envelopes are rejected with explicit, non-fatal error reporting.
- Unity runtime ingest is fail-soft: it treats `vault.noteCount` as informational (uses `notes` as source of truth).
- Unity runtime ingest is fail-soft for unresolved links: missing endpoints are tolerated at ingest and dropped later during edge resolution.
- `mapLayout` is optional and controls the preferred runtime map layout selection when the consumer supports it.

## Unity Runtime Usage Reference
- Unity-side field-to-behavior mapping, runtime defaults, and ingestion-specific fallbacks are documented in `unity/ReverySkyMap/docs/DATA_CONTRACT.md` under `Runtime Field Usage (Unity)`.

## Current Producer Semantics
- `graph:set` is the effective filtered payload emitted by the plugin view, not the raw vault snapshot.
- `notes[].date` uses `frontmatter.date`, then `frontmatter.created`, then `frontmatter.created_at`, then file creation time. Missing, blank, or invalid candidates are skipped, and the field is omitted when no valid source exists.
- `notes[].tags` are produced by merging inline tags and frontmatter tags, then normalizing and deduplicating the result.
- `notes[].size` is emitted as file size in bytes.
- `mapLayout`, when present, is a plugin-owned runtime hint and travels with the effective graph payload.
- `vault.noteCount` reflects the emitted `notes.length` for the filtered payload.
