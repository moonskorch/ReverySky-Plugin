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
  enginePreference?: GraphEnginePreference;
};

type GraphEnginePreference = "auto" | "forces" | "static25d";

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
- Incoming `graph:set` payloads are already the plugin's effective filtered graph; Unity does not own query parsing or source-graph derivation.
- `vault.noteCount` is informational for Unity ingest; runtime uses `notes` as the source of truth.
- `id` is required and stable across updates.
- `path` is vault-relative with `/` separators.
- Links with missing note ids are tolerated at ingest and dropped later during Forces edge resolution.
- `enginePreference`, when provided, must be one of: `auto`, `forces`, `static25d`.
- Unknown fields are ignored, not fatal.

## Runtime Field Usage (Unity)
Current runtime behavior snapshot for Unity ingestion and map interaction:

- `notes[].id` -> node identity, lookup, focus/selection restore, open-note flow, and link endpoint matching.
- `notes[].path` -> open-note payload path, focus fallback by path, stable visual seed source.
- `notes[].title` -> star label text.
  - fallback: empty/whitespace title maps to `GameSettings.DefaultTitle` (`"Untitled"`).
- `notes[].tags[]` -> trimmed runtime tag-id mapping; per-note deduplication is applied later by Forces engine.
  - derivation: trimmed tag string -> shared integer id mapping.
- `notes[].date` -> static-25D date depth placement.
  - fallback: parse failure or missing date maps to `DateTime.MinValue`.
  - `DateTime.MinValue` is a technical sentinel: it is excluded from the normal date range and clamped to the oldest map edge.
  - any valid date from `DateTime.MinValue.AddDays(1)` onward is treated as a normal date and may create a visible timeline gap.
  - there is no semantic cutoff that treats all dates before a chosen year as undated.
- `notes[].size` -> star scale factor via runtime percentile statistics.
  - fallback: negative size maps to `0`.
- `enginePreference` -> preferred runtime engine mode for the next graph build.
  - expected mapping: `auto` = threshold-based auto selection, `forces` = links map preference, `static25d` = dates map preference.
- `links[].sourceId` and `links[].targetId` -> note-note edges in Forces engine.
  - gate: empty ids and self-links are dropped during bridge mapping; missing runtime node ids are dropped by Forces edge resolution.
- `links[].weight` -> Forces spring rest length (`idealEdgeLen / sqrt(weight)`).
  - fallback: `weight <= 0` maps to `1`.

### Runtime-Only Defaults And Derivations
- `NoteData.CrystalType` is forced to `Unknown` at bridge mapping time.
- `NoteData.SphereType` is forced to `Unknown` at bridge mapping time.
- `NoteData.ScapeView` is initialized to `Planets` at bridge mapping time.
- Runtime tag ids (`TagIds`) and `tagId -> name` dictionary are derived locally from incoming `tags[]`.

### Temporary State
- `NoteData.CrystalType = Unknown` for bridge-ingested notes is currently retained for legacy visual compatibility only.

## Ignored And Not Enforced In Runtime
- Ignored fields: `requestId`, `payload.graphVersion`, `payload.generatedAt`, `payload.vault.noteCount`, `links[].kind`.
- Not enforced on ingest:
  - `vault.noteCount == notes.length` is documented but not validated in Unity ingest code.
  - Link endpoint existence is not validated on ingest; missing ids are dropped later during Forces edge resolution.

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
