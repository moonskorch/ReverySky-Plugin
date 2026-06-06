# ReverySky Map for Obsidian - Architecture

## Purpose
ReverySky Map is an Obsidian desktop plugin that renders vault relationships in a Unity WebGL runtime embedded in a custom Obsidian view.

## Scope
Implemented scope for the current codebase:
- Custom Obsidian view and command (`Open ReverySky Map`).
- Vault graph extraction from markdown files (notes, tags, resolved links).
- Type-safe bridge envelopes between plugin and embedded runtime.
- Unity runtime hosting through a local HTTP server bound to `127.0.0.1`.

Out of scope for this repository stage:
- Note authoring from Unity.
- Non-map gameplay systems from the standalone ReverySky application.
- Mobile-specific runtime behavior.

## Runtime Topology
1. Obsidian plugin opens a custom view.
2. View loads `unity-webgl/index.html` in an iframe.
3. `UnityIframeBridge` waits for `bridge:ready`.
4. Plugin builds graph payload and sends `graph:set`.
5. Runtime consumes payload and renders map state.

## Core Components
- `src/main.ts`: plugin lifecycle, command registration, view activation, local runtime server setup.
- `src/view/ReverySkyMapView.ts`: iframe initialization and bridge attachment.
- `src/graph/*`: vault graph extraction and normalization.
- `src/bridge/*`: protocol types, validation, bridge transport.
- `src/runtime/UnityWebglLocalServer.ts`: secure local static file serving for Unity runtime assets.

## Automated Test Baseline (TypeScript)
- Selected stack: Vitest (`vitest`) + `jsdom` for TypeScript plugin and bridge verification.
- Test layout: `tests/**/*.test.ts`.
- Scope boundary: TS tests cover plugin-side logic and bridge orchestration with mocked iframe/runtime boundary; Unity project tests are handled separately.

## Unity WebGL Asset Model
- Tracked source template: `unity-webgl/index.template.html`.
- Generated runtime host page: `unity-webgl/index.html` (not tracked).
- Runtime binaries: `unity-webgl/Build/*` (generated locally, not tracked).
- Import workflow: `scripts/import-unity-webgl.ps1` copies Unity export artifacts and generates runtime files.

## Repository Boundaries
- `unity/ReverySkyMap` is the Unity source project used to produce WebGL exports.
- `reference/` is excluded from commits and used only as a local reference workspace.

## Reference Project Policy
- `reference/ReverySky` is a reference/inspiration workspace, not a restore baseline.
- Do not rollback, reset, or bulk-copy from `reference/ReverySky` into `unity/ReverySkyMap`.
- `reference/ReverySky` may be used only for targeted comparison or selective fragment-level adaptation.

## Graph Ownership
- The plugin builds a source graph from vault data, then derives the effective `graph:set` payload in the view before sending it to Unity.
- Query parsing and filtering live on the plugin side in `src/view/ReverySkyMapView.ts` and `src/graph/GraphPathFilter.ts`.
- Current supported filter slices are `path:`, `date:`, and `tag:`; unsupported terms stay plugin-side and are surfaced as view guidance.
- `Tags` visibility and `enginePreference` are view state, not Unity-owned state.
- Unity consumes the already-filtered payload and does not own filter parsing or source-graph derivation.

## Current Graph Model
- Graph notes carry `id`, `path`, `title`, `tags`, optional canonical `date`, and `size` in bytes.
- `date` is produced from note metadata with frontmatter date preferred and file creation time as fallback.
- `tags` are merged from inline tags and frontmatter tags, then normalized and deduplicated before emission.
- `enginePreference` is an optional payload hint that travels with the effective graph when the view has a selected runtime engine.
