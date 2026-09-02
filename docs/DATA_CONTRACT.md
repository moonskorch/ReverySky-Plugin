# ReverySky 3D Graph Bridge Data Contract

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
- `graph:set`: effective graph payload after plugin-side scoping and filters.
- `note:focus`: current-note focus hint with required `id` and `path`.
- `note:update`: current note building update with required `id`, `path`, and `buildings`.
- `runtime:status`: iframe-wrapper status text update that does not change Unity graph state.
- `runtime:settings`: Unity runtime frame-rate settings that apply without rebuilding graph state.
- `runtime:screenshot-request`: best-effort request to capture the current Unity canvas as PNG and return it to the parent.
- `runtime:shutdown`: lifecycle message requesting the iframe runtime wrapper to stop bridge activity before the parent view detaches.

Runtime -> plugin:
- `bridge:ready`: runtime is initialized and ready to receive payloads after successful Unity WebGL boot.
- `graph:ready`: runtime has finished the current graph build or stabilization phase for a matching `graph:set` request.
- `note:open`: request for Obsidian to open a note by required `id` and `path`.
- `tag:activate`: notification that the runtime activated a tag node, with required string `tag`.
- `runtime:screenshot-response`: response to a screenshot request. `payload.ok: true` carries a PNG `Blob`; `payload.ok: false` reports capture failure without a bridge error string.
- `runtime:shutdown-complete`: acknowledgement for a matching `runtime:shutdown` request.

If Unity WebGL boot fails, the iframe wrapper keeps the failure status visible and intentionally does not emit `bridge:ready`; no `graph:set` is expected for that iframe.

## Graph Ready Messages
`graph:ready` is a completion acknowledgement for a specific `graph:set` request.

Runtime -> parent:

```json
{
  "protocolVersion": "2.0.0",
  "type": "graph:ready",
  "requestId": "req_..."
}
```

Rules:
- `graph:set` includes a unique `requestId`.
- `graph:ready` must echo the matching `graph:set` `requestId`.
- The iframe status UI must ignore stale `graph:ready` messages whose `requestId` does not match the latest `graph:set`.
- The runtime sends `graph:ready` after the active layout engine reaches its user-visible ready point; engines with continuous background refinement must still provide a finite ready point.

## Runtime Status Messages
`runtime:status` updates the iframe status text without sending graph data to Unity.

Parent -> runtime wrapper:

```json
{
  "protocolVersion": "2.0.0",
  "type": "runtime:status",
  "payload": {
    "text": "Updating graph data..."
  }
}
```

Rules:
- `runtime:status` has no `requestId`.
- `payload.text` must be non-empty after trimming.
- The iframe wrapper applies the text to the status UI only; it must not call Unity `SendMessage`.
- Runtime failure and shutdown states keep precedence over status updates.

## Runtime Settings Messages
`runtime:settings` applies Unity runtime frame-rate settings without sending graph data or rebuilding the map.

Parent -> runtime:

```json
{
  "protocolVersion": "2.0.0",
  "type": "runtime:settings",
  "payload": {
    "frameRateMode": "auto"
  }
}
```

Rules:
- `runtime:settings` has no `requestId`.
- `payload.frameRateMode` must be one of: `auto`, `fps60`, `fps30`, `fps24`.
- The iframe wrapper forwards valid settings to Unity `ObsidianBridge.OnRuntimeSettings(...)`.
- The Unity runtime applies the selected frame-rate mode live; it must not rebuild graph data, reset focus, or recreate the iframe.

## Screenshot Messages
`runtime:screenshot-request` asks the iframe wrapper to capture `unity-canvas` as PNG and reply with a single best-effort response. The flow may fail if the canvas is unavailable, not ready, produces no blob, times out, or sends a malformed response, and the parent treats all of those cases as the same screenshot-copy failure.

Parent -> runtime:

```json
{
  "protocolVersion": "2.0.0",
  "type": "runtime:screenshot-request"
}
```

Rules:
- The iframe wrapper captures the canvas after a short render delay and posts `runtime:screenshot-response`.
- `runtime:screenshot-response` carries `payload.ok: true` with a `payload.blob` PNG image when capture succeeds.
- `runtime:screenshot-response` carries `payload.ok: false` when capture fails.
- The parent treats the response as a one-shot reply for the pending screenshot request.
- The parent view reports any screenshot-copy failure with the same user-facing notice: `Failed to copy screenshot.`

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
  buildings?: string[];
  date?: string;
  size: number;
};

type GraphLink = {
  sourceId: string;
  targetId: string;
  weight?: number;
  kind?: "resolved";
};

type NoteUpdatePayload = {
  id: string;
  path: string;
  buildings: string[];
};
```

## Normalization Rules
- `path` must be vault-relative and use `/` separators.
- `id` must be stable for the same note across sessions.
- `title` is trimmed and limited to 100 characters for runtime payloads.
- `date` must be a single canonical note date in ISO 8601 format when provided.
- `size` must be a non-negative integer measured in bytes.
- `graph:set` `buildings`, when provided, must be a non-empty array of non-empty strings.
- `note:update` `buildings` must be an array of non-empty strings; an empty array is valid and means all buildings were removed.
- `buildings` entries are trimmed and limited to 64 characters for runtime payloads.
- `mapLayout`, when provided, must be one of: `auto`, `dynamicLinks`, `dates`, `scalableLinks`.
- Producer rule: `vault.noteCount` should equal `notes.length` for every emitted payload.
- Unknown fields must be safely ignored by consumers.

## Validation Requirements
- Outgoing `graph:set` payloads are validated before postMessage dispatch.
- Outgoing `note:update` payloads are validated before postMessage dispatch.
- Outgoing `runtime:status` messages are skipped when the status text is empty after trimming.
- Outgoing `runtime:settings` payloads are validated before postMessage dispatch.
- Outgoing `runtime:screenshot-request` messages are validated before postMessage dispatch.
- Incoming `bridge:ready` is accepted only when `protocolVersion` matches exactly.
- Incoming `graph:ready` is accepted only when `protocolVersion` matches and `requestId` is a non-empty string.
- Incoming `note:open` is accepted only when `protocolVersion` matches and the payload includes non-empty `id` and `path`.
- Incoming `runtime:screenshot-response` is accepted only when `protocolVersion` matches and `payload.ok` is boolean with `payload.blob` present only when `ok` is `true`. Malformed screenshot responses are treated as a failed copy attempt by the parent view.
- Incoming `runtime:shutdown-complete` is accepted only when `protocolVersion` matches and `requestId` is a non-empty string matching the pending shutdown request.
- Invalid envelopes are rejected with explicit, non-fatal error reporting.
- Unity runtime ingest is fail-soft: it treats `vault.noteCount` as informational (uses `notes` as source of truth).
- Unity runtime ingest is fail-soft for unresolved links: missing endpoints are tolerated at ingest and dropped later during edge resolution.
- `mapLayout` is optional and controls the preferred runtime layout selection when the consumer supports it.

## Unity Runtime Usage Reference
- Unity-side field-to-behavior mapping, runtime defaults, and ingestion-specific fallbacks are documented in `unity/ReverySkyMap/docs/DATA_CONTRACT.md` under `Runtime Field Usage (Unity)`.

## Current Producer Semantics
- `graph:set` is the effective payload emitted by the plugin view, not the raw vault snapshot. The effective payload applies the query filter first while retaining the Ego center when needed, then narrows by Ego scope before tag visibility filtering runs.
- Each emitted `graph:set` gets a unique `requestId` so stale `graph:ready` messages cannot complete a newer graph status.
- After startup graph emission, `MapSession` lets the first Obsidian `metadataCache.resolved` event refresh cached vault graph data from settled `resolvedLinks`.
- After graph-relevant metadata changes, `MapSession` waits for Obsidian `metadataCache.resolved` before rebuilding from `metadataCache.resolvedLinks`; while waiting, it may send `runtime:status` instead of `graph:set`.
- The configured landmark source property defaults to `landmarks`; source-only metadata changes are not graph-rebuild signals by themselves. When tags and links stay stable and the normalized landmarks list changes, `MapSession` emits `note:update` immediately from `metadataCache.changed`.
- Filter-only changes reuse the latest source graph snapshot and emit only a newly narrowed payload after the filter debounce.
- Graph-setting changes such as tag visibility, layout, Ego mode, Ego depth, and Ego neighbor links reuse the latest source graph snapshot and coalesce live `graph:set` emission through the graph-settings debounce.
- Runtime unavailable during iframe restart or window migration flushes pending source-refresh, filter, and graph-settings debounce work so the next `bridge:ready` emits the latest effective payload.
- Ego focus acceptance updates the plugin-side focus path independently from bridge dispatch. Ordinary Ego focus rebuilds the effective payload around a changed center before sending `note:focus`; startup accepts the active center before the initial `graph:set`; active-note rename can skip the immediate Ego rebuild because the rename event already schedules a fresh source graph rebuild.
- `notes[].date` uses `frontmatter.date`, then `frontmatter.created`, then `frontmatter.created_at`, then file creation time. Missing, blank, or invalid candidates are skipped, and the field is omitted when no valid source exists.
- Source `notes[].tags` are merged, normalized, and deduplicated; effective `graph:set` payloads may clear or trim them for tag visibility.
- `notes[].buildings` uses the configured frontmatter landmark source property, defaulting to `landmarks`, when it is a string or an array. A scalar string maps to one building name without separator splitting; arrays contribute only string items. Whole-string wikilinks map to their alias or final path segment. Names are trimmed and limited to 64 characters, non-string and blank items are ignored, and the field is omitted when no names remain.
- `notes[].size` is emitted as file size in bytes.
- `mapLayout`, when present, is a plugin-owned runtime hint and travels with the effective graph payload.
- `note:focus` carries the current note identity separately; `graph:set` stays focused on the graph payload itself.
- `note:update` carries the current note identity and full normalized `buildings` list separately; `graph:set` stays focused on full graph replacement.
- `runtime:settings` carries frame-rate mode separately; `graph:set` stays focused on graph payload data.
- `vault.noteCount` reflects the emitted `notes.length` for the effective payload.

## Graph Payload Examples
`links[]` carries note-to-note edges only. Unity derives tag nodes and note-to-tag edges from `notes[].tags`.

Base graph before Ego scoping:

```json
{
  "notes": [
    { "id": "A", "path": "A.md", "title": "Center", "tags": ["x"], "size": 10 },
    { "id": "B", "path": "B.md", "title": "Neighbor", "tags": ["x", "y"], "size": 10 },
    { "id": "C", "path": "C.md", "title": "Outer", "tags": ["y", "z"], "size": 10 }
  ],
  "links": [
    { "sourceId": "A", "targetId": "B", "kind": "resolved" },
    { "sourceId": "B", "targetId": "C", "kind": "resolved" }
  ]
}
```

This lets Unity render note nodes `A`, `B`, `C`; note-to-note edges `A-B`, `B-C`; tag nodes `x`, `y`, `z`; and note-to-tag edges `A-x`, `B-x`, `B-y`, `C-y`, `C-z`.

For Ego center `A`, depth `1`, and neighbor links disabled, the effective payload keeps only the center-owned tag edge:

```json
{
  "notes": [
    { "id": "A", "path": "A.md", "title": "Center", "tags": ["x"], "size": 10 },
    { "id": "B", "path": "B.md", "title": "Neighbor", "tags": [], "size": 10 }
  ],
  "links": [
    { "sourceId": "A", "targetId": "B", "kind": "resolved" }
  ]
}
```

For Ego center `A`, depth `2`, and neighbor links disabled, depth `1` notes may introduce new tag edges, while boundary depth `2` notes do not introduce or reconnect tag edges:

```json
{
  "notes": [
    { "id": "A", "path": "A.md", "title": "Center", "tags": ["x"], "size": 10 },
    { "id": "B", "path": "B.md", "title": "Neighbor", "tags": ["y"], "size": 10 },
    { "id": "C", "path": "C.md", "title": "Outer", "tags": [], "size": 10 }
  ],
  "links": [
    { "sourceId": "A", "targetId": "B", "kind": "resolved" },
    { "sourceId": "B", "targetId": "C", "kind": "resolved" }
  ]
}
```

For Ego center `A`, depth `2`, and neighbor links enabled, visible notes keep tag memberships to already visible tag nodes:

```json
{
  "notes": [
    { "id": "A", "path": "A.md", "title": "Center", "tags": ["x"], "size": 10 },
    { "id": "B", "path": "B.md", "title": "Neighbor", "tags": ["x", "y"], "size": 10 },
    { "id": "C", "path": "C.md", "title": "Outer", "tags": ["y"], "size": 10 }
  ],
  "links": [
    { "sourceId": "A", "targetId": "B", "kind": "resolved" },
    { "sourceId": "B", "targetId": "C", "kind": "resolved" }
  ]
}
```
