# Unity Runtime Data Contract (Subset)

This document defines the Unity-side subset of the bridge contract used by runtime ingestion.

Canonical source:
- `../../docs/DATA_CONTRACT.md`

If this file conflicts with canonical contract, canonical contract wins.

## Protocol Gate
- `protocolVersion` must match expected version exactly.
- Runtime-ready signal is `bridge:ready`.
- Runtime ingestion message is `graph:set`.
- Runtime note building update message is `note:update`.
- Runtime settings message is `runtime:settings`.
- Runtime graph completion signal is `graph:ready`.
- Runtime tag activation signal is `tag:activate`.
- Runtime shutdown message is `runtime:shutdown`.

## Envelope Shape
Expected envelope:

```json
{
  "protocolVersion": "2.0.0",
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
- `requestId` (string; parent builds now provide this for `graph:set` so Unity can echo it in `graph:ready`)

## Runtime Settings Handling
`runtime:settings` applies Unity runtime settings without rebuilding graph data.

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

Unity-side behavior:
- The iframe JavaScript wrapper forwards `runtime:settings` to `ObsidianBridge.OnRuntimeSettings(string json)` after Unity is ready.
- `ObsidianBridge.OnRuntimeSettings` rejects wrong `protocolVersion` and wrong `type`.
- `payload.frameRateMode` accepts `auto`, `fps60`, `fps30`, or `fps24`.
- `auto` sets `Application.targetFrameRate = -1` and `QualitySettings.vSyncCount = 1`.
- Fixed modes set `QualitySettings.vSyncCount = 0` and `Application.targetFrameRate` to `60`, `30`, or `24`.
- Unknown runtime-side mode values fall back to `auto` with a warning; the parent TypeScript bridge validates and should not send them.
- Applying `runtime:settings` must not call `MapRuntimeContext.SetNotes`, rebuild graph data, reset focus, or recreate the iframe.

## Note Update Handling
`note:update` carries a single note identity and its full current building list. Unity applies it as a targeted update to the existing runtime note and its rendered star.

Parent -> runtime:

```json
{
  "protocolVersion": "2.0.0",
  "type": "note:update",
  "payload": {
    "id": "note_...",
    "path": "Folder/Note.md",
    "buildings": []
  }
}
```

Unity-side behavior:
- The iframe JavaScript wrapper forwards `note:update` to `ObsidianBridge.OnNoteUpdate(string json)` after Unity is ready.
- `ObsidianBridge.OnNoteUpdate` rejects wrong `protocolVersion` and wrong `type`.
- `payload.buildings` is the full current list; an empty array means all buildings were removed.
- `payload.id` and `payload.path` must match an existing runtime note. Unknown notes or path mismatches are logged and ignored.
- Accepted updates replace only `NoteData.Buildings`, then refresh the current star's building callouts when that star exists in the active `MapGraphIndex`.
- Accepted updates must not call `MapRuntimeContext.SetNotes`, rebuild graph data, reset focus, change links, or change note placement.

## Graph Ready Handling
`graph:ready` is Unity's completion acknowledgement for one parent `graph:set`.

Runtime -> parent:

```json
{
  "protocolVersion": "2.0.0",
  "type": "graph:ready",
  "requestId": "req_..."
}
```

Unity-side behavior:
- `ObsidianBridge.OnGraphSet` passes the incoming `requestId` to `MapRuntimeContext.SetNotes(...)` after payload normalization succeeds.
- `MapRuntimeContext.OnNotesChanged(requestId)` carries that id to `Cartographer`.
- `Cartographer` sets the building graph request id when a graph build starts, using the request id carried by the rebuild coroutine.
- Engines call `MapRuntimeContext.RequestGraphReady()` when their current graph reaches its user-visible ready point.
- `MapRuntimeContext.RequestGraphReady()` emits the building graph `requestId`; the iframe wrapper ignores stale `graph:ready` messages whose `requestId` no longer matches the latest accepted `graph:set`.
- `MapRuntimeContext.OnGraphReady` reaches `ObsidianBridge.HandleGraphReadyRequested`.
- WebGL builds forward the event to JavaScript via `ReverySkyBridgePostGraphReady(requestId)`.
- Empty or whitespace `requestId` is not sent out as `graph:ready`; this avoids a startup empty-graph rebuild producing an invalid completion event.
- `Dates` and `DynamicLinks` signal ready after their synchronous build publishes visual nodes.
- `RecursiveHubs` signals ready after an empty graph, after instant/endless construction completion, or after timed visual smoothing settles following the final finite refinement pass.
- Parent iframe status owns the visible loading text and only clears `N notes, M links (loading...)` when `graph:ready.requestId` matches the latest `graph:set`.

## Tag Activate Handling
`tag:activate` notifies the parent plugin that the user activated a runtime tag node.

Runtime -> parent:

```json
{
  "protocolVersion": "2.0.0",
  "type": "tag:activate",
  "requestId": "evt_...",
  "payload": {
    "tag": "project"
  }
}
```

Unity-side behavior:
- `FocusNode` emits tag activation only after a `TagNode` resolves through the current `MapGraphIndex` and receives local camera focus.
- `MapRuntimeContext.RequestTagActivate(tagId)` converts Unity's runtime tag id back to the original bridge tag string via the current tag-name dictionary.
- Empty or unknown runtime tag ids do not emit `tag:activate`.
- WebGL builds forward the event to JavaScript via `ReverySkyBridgePostTagActivate(tag)`.
- The event is notification-only in Unity; parent-side focus policy owns any later note-focus or tag-search behavior.

## Runtime Shutdown Handling
Unity WebGL shutdown is a bridge/runtime-wrapper lifecycle guard, not a full Unity engine shutdown.

Expected shutdown envelope:

```json
{
  "protocolVersion": "2.0.0",
  "type": "runtime:shutdown",
  "requestId": "shutdown_..."
}
```

Unity-side behavior:
- The iframe JS wrapper receives `runtime:shutdown`, enters `isShuttingDown`, removes its own bridge listeners, and replies to the parent with `runtime:shutdown-complete`.
- The iframe JS wrapper forwards shutdown to `ObsidianBridge.OnRuntimeShutdown(string json)` when the Unity instance can receive messages.
- `ObsidianBridge.OnRuntimeShutdown` marks the bridge as shutting down and unsubscribes from `MapRuntimeContext.OnOpenNoteRequested`, `MapRuntimeContext.OnTagActivateRequested`, and `MapRuntimeContext.OnGraphReady`.
- After shutdown, `ObsidianBridge.OnGraphSet`, `ObsidianBridge.OnNoteFocus`, and `ObsidianBridge.OnNoteUpdate` return without processing.
- After shutdown, `ObsidianBridge.OnRuntimeSettings` returns without changing frame-rate state.
- After shutdown, `HandleOpenNoteRequested`, `HandleTagActivateRequested`, and `HandleGraphReadyRequested` return without sending outbound bridge events.

Non-goals:
- Do not call `Application.Quit()`.
- Do not call Unity WebGL `Quit()`.
- Do not destroy Unity scene objects.
- Do not treat shutdown as graph data cleanup.

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
  mapLayout?: MapLayoutPreference;
};

type MapLayoutPreference = "auto" | "dynamicLinks" | "dates" | "scalableLinks";

type RuntimeSettingsPayload = {
  frameRateMode: FrameRateMode;
};

type FrameRateMode = "auto" | "fps60" | "fps30" | "fps24";

type NoteUpdatePayload = {
  id: string;
  path: string;
  buildings: string[];
};

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
```

## Unity Ingestion Invariants
- Incoming `graph:set` payloads are already the plugin's effective filtered graph; Unity does not own query parsing or source-graph derivation.
- `vault.noteCount` is informational for Unity ingest; runtime uses `notes` as the source of truth.
- `id` is required and stable across updates.
- `path` is vault-relative with `/` separators.
- Links with missing note ids are tolerated at ingest and dropped later during Forces edge resolution.
- `mapLayout`, when provided, must be one of: `auto`, `dynamicLinks`, `dates`, `scalableLinks`.
- `runtime:settings.payload.frameRateMode` must be one of: `auto`, `fps60`, `fps30`, `fps24`.
- Unknown fields are ignored, not fatal.

## Runtime Field Usage (Unity)
Current runtime behavior snapshot for Unity ingestion and map interaction:

- `notes[].id` -> node identity, lookup, focus/selection restore, open-note flow, and link endpoint matching.
- `notes[].path` -> open-note payload path and stable visual seed source.
- `notes[].title` -> star label text.
  - fallback: empty/whitespace title maps to `GameSettings.DefaultTitle` (`"Untitled"`).
- `notes[].tags[]` -> trimmed runtime tag-id mapping; per-note deduplication is applied later by Forces engine.
  - derivation: trimmed tag string -> shared integer id mapping.
- `notes[].buildings[]` -> `NoteData.Buildings`; each string maps to one `BuildingData.Name`.
  - producer source: `frontmatter.landmarks` when it is an array; non-string and blank items are ignored, and the field is omitted when no names remain.
  - fallback: missing field maps to an empty `NoteData.Buildings` list.
- `notes[].date` -> static-25D date depth placement.
  - fallback: parse failure or missing date maps to `DateTime.MinValue`.
  - `DateTime.MinValue` is a technical sentinel: it is excluded from the normal date range and clamped to the oldest map edge.
  - any valid date from `DateTime.MinValue.AddDays(1)` onward is treated as a normal date and may create a visible timeline gap.
  - there is no semantic cutoff that treats all dates before a chosen year as undated.
- `notes[].size` -> star scale factor via runtime percentile statistics.
  - fallback: negative size maps to `0`.
- `mapLayout` -> preferred runtime map layout for the next graph build.
  - expected mapping: `auto` = threshold-based selection (`DynamicLinks` for small graphs, `ScalableLinks` for large graphs), `dynamicLinks` = links map preference with the same large-graph fallback to `ScalableLinks`, `dates` = explicit dates map preference, `scalableLinks` = explicit scalable links map preference.
- `runtime:settings.payload.frameRateMode` -> live Unity frame-rate mode.
  - expected mapping: `auto` = vSync on and platform/browser cadence, `fps60` = software cap at 60 FPS, `fps30` = software cap at 30 FPS, `fps24` = software cap at 24 FPS.
- envelope `requestId` -> stored with the accepted runtime notes, carried through `OnNotesChanged(requestId)` and the active rebuild coroutine, then echoed through `graph:ready` after that build reaches its ready point.
- `links[].sourceId` and `links[].targetId` -> note-note edges in Forces engine.
  - gate: empty ids and self-links are dropped during bridge mapping; missing runtime node ids are dropped by Forces edge resolution.
- `links[].weight` -> Forces spring rest length (`idealEdgeLen / sqrt(weight)`).
  - fallback: `weight <= 0` maps to `1`.

### Runtime-Only Defaults And Derivations
- `NoteData.CrystalType` is forced to `Unknown` at bridge mapping time.
- `NoteData.SphereType` is forced to `Unknown` at bridge mapping time.
- `NoteData.ScapeView` is initialized to `Planets` at bridge mapping time.
- Runtime tag ids (`TagIds`) and `tagId -> name` dictionary are derived locally from incoming `tags[]`.
- `NoteData.DirectLinkCount` is derived locally from unique direct note-note neighbors in `MapRuntimeContext.Links`.
- Star core visuals map `DirectLinkCount` to crystal buckets: 0 -> `Value1`, 1 -> `Value2`, 2+ -> `Value3`.

### Temporary State
- `NoteData.CrystalType = Unknown` for bridge-ingested notes is currently retained for legacy visual compatibility only.

## Ignored And Not Enforced In Runtime
- Ignored fields: `payload.graphVersion`, `payload.generatedAt`, `payload.vault.noteCount`, `links[].kind`.
- Not enforced on ingest:
  - `vault.noteCount == notes.length` is documented but not validated in Unity ingest code.
  - Link endpoint existence is not validated on ingest; missing ids are dropped later during Forces edge resolution.
  - Non-empty `graph:set.requestId` is expected for parent completion tracking, but Unity still ingests graph data without it and simply suppresses outbound `graph:ready`.

## Error Handling Expectations
- Invalid envelope or protocol mismatch must be rejected gracefully.
- Repeated `graph:set` calls must rebuild or update runtime state without stale leftovers.
- Repeated `runtime:settings` calls must update frame-rate state live without graph rebuild side effects.
- `runtime:shutdown` must stop bridge input/output without requiring a Unity engine quit.
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
